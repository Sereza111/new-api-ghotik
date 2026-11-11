package model

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	PlaygroundConversationMaxPerUser       = 100
	PlaygroundConversationMaxMessages      = 100
	PlaygroundConversationMaxMessageBytes  = 40 * 1024
	PlaygroundConversationMaxMessagesBytes = 1024 * 1024
	PlaygroundConversationMaxTitleRunes    = 100
	PlaygroundConversationMaxModelBytes    = 255
	PlaygroundConversationMaxConfigBytes   = 16 * 1024
)

var (
	ErrPlaygroundConversationNotFound = errors.New("playground conversation not found")
	ErrPlaygroundConversationConflict = errors.New("playground conversation was changed in another session")
	ErrPlaygroundConversationLimit    = errors.New("playground conversation limit reached")
	ErrPlaygroundConversationInvalid  = errors.New("invalid playground conversation")
)

// PlaygroundConversation stores durable playground metadata and configuration.
// Message bodies live in a separate table so individual TEXT values stay safely
// below MySQL's TEXT limit while remaining portable across all supported DBs.
type PlaygroundConversation struct {
	ID               string `json:"id" gorm:"column:id;type:varchar(32);primaryKey"`
	UserID           int    `json:"-" gorm:"column:user_id;not null;index:idx_playground_conversations_user_updated,priority:1"`
	Title            string `json:"title" gorm:"type:varchar(100);not null"`
	Model            string `json:"model" gorm:"type:varchar(255);not null"`
	Config           string `json:"-" gorm:"type:text;not null"`
	ParameterEnabled string `json:"-" gorm:"type:text;not null"`
	Revision         int64  `json:"revision" gorm:"type:bigint;not null"`
	CreatedAt        int64  `json:"created_at" gorm:"type:bigint;not null"`
	UpdatedAt        int64  `json:"updated_at" gorm:"type:bigint;not null;index:idx_playground_conversations_user_updated,priority:2"`
	MessageCount     int64  `json:"message_count" gorm:"-"`
}

func (PlaygroundConversation) TableName() string {
	return "playground_conversations"
}

// PlaygroundConversationMessage stores one sanitized playground message JSON.
// Images and data URLs are intentionally omitted by the controller before this
// layer is called.
type PlaygroundConversationMessage struct {
	ID             int64  `json:"-" gorm:"primaryKey"`
	ConversationID string `json:"-" gorm:"column:conversation_id;type:varchar(32);not null;uniqueIndex:idx_playground_messages_conversation_position,priority:1;index:idx_playground_messages_user_conversation,priority:2"`
	UserID         int    `json:"-" gorm:"column:user_id;not null;index:idx_playground_messages_user_conversation,priority:1"`
	Position       int    `json:"-" gorm:"not null;uniqueIndex:idx_playground_messages_conversation_position,priority:2"`
	Payload        string `json:"-" gorm:"type:text;not null"`
}

func (PlaygroundConversationMessage) TableName() string {
	return "playground_messages"
}

type PlaygroundConversationUpdate struct {
	Title            *string
	Model            *string
	Config           *string
	ParameterEnabled *string
	Messages         *[]string
}

func validatePlaygroundMessagePayloads(payloads []string) error {
	if len(payloads) > PlaygroundConversationMaxMessages {
		return ErrPlaygroundConversationInvalid
	}
	totalBytes := 0
	for _, payload := range payloads {
		payloadBytes := len(payload)
		if payloadBytes == 0 || payloadBytes > PlaygroundConversationMaxMessageBytes {
			return ErrPlaygroundConversationInvalid
		}
		totalBytes += payloadBytes
		if totalBytes > PlaygroundConversationMaxMessagesBytes {
			return ErrPlaygroundConversationInvalid
		}
	}
	return nil
}

func validatePlaygroundConversationFields(title, modelName, config, parameterEnabled string) error {
	if strings.TrimSpace(title) == "" || !utf8.ValidString(title) || utf8.RuneCountInString(title) > PlaygroundConversationMaxTitleRunes {
		return ErrPlaygroundConversationInvalid
	}
	if len(modelName) > PlaygroundConversationMaxModelBytes || !utf8.ValidString(modelName) {
		return ErrPlaygroundConversationInvalid
	}
	if strings.TrimSpace(config) == "" || len(config) > PlaygroundConversationMaxConfigBytes ||
		strings.TrimSpace(parameterEnabled) == "" || len(parameterEnabled) > PlaygroundConversationMaxConfigBytes {
		return ErrPlaygroundConversationInvalid
	}
	return nil
}

func replacePlaygroundConversationMessages(tx *gorm.DB, conversation *PlaygroundConversation, payloads []string) error {
	if err := validatePlaygroundMessagePayloads(payloads); err != nil {
		return err
	}
	if err := tx.Where("user_id = ? AND conversation_id = ?", conversation.UserID, conversation.ID).
		Delete(&PlaygroundConversationMessage{}).Error; err != nil {
		return err
	}
	if len(payloads) == 0 {
		return nil
	}
	messages := make([]PlaygroundConversationMessage, 0, len(payloads))
	for position, payload := range payloads {
		messages = append(messages, PlaygroundConversationMessage{
			ConversationID: conversation.ID,
			UserID:         conversation.UserID,
			Position:       position,
			Payload:        payload,
		})
	}
	return tx.Create(&messages).Error
}

func CreatePlaygroundConversation(userID int, title, modelName, config, parameterEnabled string, payloads []string) (*PlaygroundConversation, error) {
	if userID <= 0 {
		return nil, ErrPlaygroundConversationInvalid
	}
	if err := validatePlaygroundConversationFields(title, modelName, config, parameterEnabled); err != nil {
		return nil, ErrPlaygroundConversationInvalid
	}
	if err := validatePlaygroundMessagePayloads(payloads); err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	conversation := &PlaygroundConversation{
		ID:               common.GetUUID(),
		UserID:           userID,
		Title:            title,
		Model:            modelName,
		Config:           config,
		ParameterEnabled: parameterEnabled,
		Revision:         1,
		CreatedAt:        now,
		UpdatedAt:        now,
		MessageCount:     int64(len(payloads)),
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", userID).First(&user).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&PlaygroundConversation{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			return err
		}
		if count >= PlaygroundConversationMaxPerUser {
			return ErrPlaygroundConversationLimit
		}
		if err := tx.Create(conversation).Error; err != nil {
			return err
		}
		return replacePlaygroundConversationMessages(tx, conversation, payloads)
	})
	if err != nil {
		return nil, err
	}
	return conversation, nil
}

func ListPlaygroundConversations(userID int) ([]PlaygroundConversation, error) {
	conversations := make([]PlaygroundConversation, 0)
	if err := DB.Where("user_id = ?", userID).
		Order("updated_at DESC, id DESC").
		Limit(PlaygroundConversationMaxPerUser).
		Find(&conversations).Error; err != nil {
		return nil, err
	}
	if len(conversations) == 0 {
		return conversations, nil
	}

	type messageCount struct {
		ConversationID string `gorm:"column:conversation_id"`
		Count          int64  `gorm:"column:message_count"`
	}
	counts := make([]messageCount, 0, len(conversations))
	if err := DB.Model(&PlaygroundConversationMessage{}).
		Select("conversation_id, COUNT(*) AS message_count").
		Where("user_id = ?", userID).
		Group("conversation_id").
		Scan(&counts).Error; err != nil {
		return nil, err
	}
	countByID := make(map[string]int64, len(counts))
	for _, count := range counts {
		countByID[count.ConversationID] = count.Count
	}
	for i := range conversations {
		conversations[i].MessageCount = countByID[conversations[i].ID]
	}
	return conversations, nil
}

type playgroundConversationRow struct {
	ID               string  `gorm:"column:id"`
	UserID           int     `gorm:"column:user_id"`
	Title            string  `gorm:"column:title"`
	Model            string  `gorm:"column:model"`
	Config           string  `gorm:"column:config"`
	ParameterEnabled string  `gorm:"column:parameter_enabled"`
	Revision         int64   `gorm:"column:revision"`
	CreatedAt        int64   `gorm:"column:created_at"`
	UpdatedAt        int64   `gorm:"column:updated_at"`
	MessagePayload   *string `gorm:"column:message_payload"`
}

func getPlaygroundConversationWithDB(db *gorm.DB, userID int, id string) (*PlaygroundConversation, []string, error) {
	rows := make([]playgroundConversationRow, 0)
	err := db.Table("playground_conversations AS conversation").
		Select(`conversation.id, conversation.user_id, conversation.title, conversation.model,
			conversation.config, conversation.parameter_enabled, conversation.revision,
			conversation.created_at, conversation.updated_at, message.payload AS message_payload`).
		Joins(`LEFT JOIN playground_messages AS message
			ON message.user_id = conversation.user_id AND message.conversation_id = conversation.id`).
		Where("conversation.user_id = ? AND conversation.id = ?", userID, id).
		Order("message.position ASC").
		Find(&rows).Error
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, ErrPlaygroundConversationNotFound
	}

	first := rows[0]
	conversation := &PlaygroundConversation{
		ID:               first.ID,
		UserID:           first.UserID,
		Title:            first.Title,
		Model:            first.Model,
		Config:           first.Config,
		ParameterEnabled: first.ParameterEnabled,
		Revision:         first.Revision,
		CreatedAt:        first.CreatedAt,
		UpdatedAt:        first.UpdatedAt,
	}
	payloads := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.MessagePayload != nil {
			payloads = append(payloads, *row.MessagePayload)
		}
	}
	conversation.MessageCount = int64(len(payloads))
	return conversation, payloads, nil
}

func GetPlaygroundConversation(userID int, id string) (*PlaygroundConversation, []string, error) {
	return getPlaygroundConversationWithDB(DB, userID, id)
}

func UpdatePlaygroundConversation(userID int, id string, expectedRevision int64, update PlaygroundConversationUpdate) (*PlaygroundConversation, []string, error) {
	if userID <= 0 || id == "" || expectedRevision <= 0 || expectedRevision >= 1<<63-1 {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.Title == nil && update.Model == nil && update.Config == nil && update.ParameterEnabled == nil && update.Messages == nil {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.Title != nil && (strings.TrimSpace(*update.Title) == "" || !utf8.ValidString(*update.Title) || utf8.RuneCountInString(*update.Title) > PlaygroundConversationMaxTitleRunes) {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.Model != nil && (len(*update.Model) > PlaygroundConversationMaxModelBytes || !utf8.ValidString(*update.Model)) {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.Config != nil && (strings.TrimSpace(*update.Config) == "" || len(*update.Config) > PlaygroundConversationMaxConfigBytes) {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.ParameterEnabled != nil && (strings.TrimSpace(*update.ParameterEnabled) == "" || len(*update.ParameterEnabled) > PlaygroundConversationMaxConfigBytes) {
		return nil, nil, ErrPlaygroundConversationInvalid
	}
	if update.Messages != nil {
		if err := validatePlaygroundMessagePayloads(*update.Messages); err != nil {
			return nil, nil, err
		}
	}
	var conversation *PlaygroundConversation
	var payloads []string
	err := DB.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"revision":   expectedRevision + 1,
			"updated_at": time.Now().Unix(),
		}
		if update.Title != nil {
			updates["title"] = *update.Title
		}
		if update.Model != nil {
			updates["model"] = *update.Model
		}
		if update.Config != nil {
			updates["config"] = *update.Config
		}
		if update.ParameterEnabled != nil {
			updates["parameter_enabled"] = *update.ParameterEnabled
		}
		result := tx.Model(&PlaygroundConversation{}).
			Where("user_id = ? AND id = ? AND revision = ?", userID, id, expectedRevision).
			Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var count int64
			if err := tx.Model(&PlaygroundConversation{}).
				Where("user_id = ? AND id = ?", userID, id).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ErrPlaygroundConversationNotFound
			}
			return ErrPlaygroundConversationConflict
		}
		conversationRef := &PlaygroundConversation{ID: id, UserID: userID}
		if update.Messages != nil {
			if err := replacePlaygroundConversationMessages(tx, conversationRef, *update.Messages); err != nil {
				return err
			}
		}
		var err error
		conversation, payloads, err = getPlaygroundConversationWithDB(tx, userID, id)
		return err
	})
	if err != nil {
		return nil, nil, err
	}
	return conversation, payloads, nil
}

func DeletePlaygroundConversation(userID int, id string) error {
	if userID <= 0 || id == "" {
		return ErrPlaygroundConversationInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("user_id = ? AND id = ?", userID, id).Delete(&PlaygroundConversation{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPlaygroundConversationNotFound
		}
		return tx.Where("user_id = ? AND conversation_id = ?", userID, id).
			Delete(&PlaygroundConversationMessage{}).Error
	})
}

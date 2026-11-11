package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testPlaygroundConversationMigration(t *testing.T, db *gorm.DB, dialect string) {
	t.Helper()
	suffix := time.Now().UnixNano()
	conversationTable := fmt.Sprintf("playground_conversations_%d", suffix)
	messageTable := fmt.Sprintf("playground_messages_%d", suffix)
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(messageTable))
		require.NoError(t, db.Migrator().DropTable(conversationTable))
	})

	conversationDB := db.Table(conversationTable)
	messageDB := db.Table(messageTable)
	for range 2 {
		require.NoError(t, conversationDB.AutoMigrate(&PlaygroundConversation{}))
		require.NoError(t, messageDB.AutoMigrate(&PlaygroundConversationMessage{}))
	}

	conversation := PlaygroundConversation{
		ID:               "migration-conversation",
		UserID:           41,
		Title:            "Preserved title",
		Model:            "model-a",
		Config:           `{}`,
		ParameterEnabled: `{}`,
		Revision:         1,
		CreatedAt:        10,
		UpdatedAt:        11,
	}
	require.NoError(t, conversationDB.Create(&conversation).Error)
	require.NoError(t, messageDB.Create(&PlaygroundConversationMessage{
		ConversationID: conversation.ID,
		UserID:         conversation.UserID,
		Position:       0,
		Payload:        `{"key":"message-a"}`,
	}).Error)
	// Re-running startup migration must be idempotent and preserve data.
	require.NoError(t, conversationDB.AutoMigrate(&PlaygroundConversation{}))
	require.NoError(t, messageDB.AutoMigrate(&PlaygroundConversationMessage{}))
	var stored PlaygroundConversation
	require.NoError(t, conversationDB.First(&stored, "id = ?", conversation.ID).Error)
	assert.Equal(t, conversation.Title, stored.Title)
	var messageCount int64
	require.NoError(t, messageDB.Where("conversation_id = ?", conversation.ID).Count(&messageCount).Error)
	assert.Equal(t, int64(1), messageCount)

	for _, column := range []string{"id", "user_id", "title", "model", "config", "parameter_enabled", "revision", "created_at", "updated_at"} {
		assert.True(t, db.Migrator().HasColumn(conversationTable, column), "%s conversation column %s", dialect, column)
	}
	for _, column := range []string{"id", "conversation_id", "user_id", "position", "payload"} {
		assert.True(t, db.Migrator().HasColumn(messageTable, column), "%s message column %s", dialect, column)
	}
}

func TestPlaygroundConversationMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:playground-migration?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	testPlaygroundConversationMigration(t, db, "sqlite")
}

func TestPlaygroundConversationMigrationMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testPlaygroundConversationMigration(t, db, "mysql")
}

func TestPlaygroundConversationMigrationPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testPlaygroundConversationMigration(t, db, "postgres")
}

func TestPlaygroundConversationCRUDScopesOwnershipAndRevision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:playground-crud?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &PlaygroundConversation{}, &PlaygroundConversationMessage{}))

	previousDB := DB
	previousType := common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
	})

	owner := User{Username: "playground-owner", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "pg-owner"}
	other := User{Username: "playground-other", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "pg-other"}
	require.NoError(t, db.Create(&owner).Error)
	require.NoError(t, db.Create(&other).Error)

	payloads := []string{`{"key":"m1","from":"user","versions":[{"id":"v1","content":"hello"}]}`}
	created, err := CreatePlaygroundConversation(owner.Id, "First", "model-a", `{}`, `{}`, payloads)
	require.NoError(t, err)
	assert.Equal(t, int64(1), created.Revision)
	assert.Len(t, created.ID, 32)

	loaded, loadedPayloads, err := GetPlaygroundConversation(owner.Id, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.Title, loaded.Title)
	assert.Equal(t, payloads, loadedPayloads)
	_, _, err = GetPlaygroundConversation(other.Id, created.ID)
	assert.ErrorIs(t, err, ErrPlaygroundConversationNotFound)

	newTitle := "Renamed"
	updatedPayloads := []string{payloads[0], `{"key":"m2","from":"assistant","versions":[{"id":"v2","content":"world"}]}`}
	updated, storedPayloads, err := UpdatePlaygroundConversation(owner.Id, created.ID, 1, PlaygroundConversationUpdate{
		Title:    &newTitle,
		Messages: &updatedPayloads,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2), updated.Revision)
	assert.Equal(t, newTitle, updated.Title)
	assert.Equal(t, updatedPayloads, storedPayloads)

	_, _, err = UpdatePlaygroundConversation(owner.Id, created.ID, 1, PlaygroundConversationUpdate{Title: &newTitle})
	assert.ErrorIs(t, err, ErrPlaygroundConversationConflict)
	_, _, err = UpdatePlaygroundConversation(owner.Id, created.ID, 2, PlaygroundConversationUpdate{})
	assert.ErrorIs(t, err, ErrPlaygroundConversationInvalid)
	assert.ErrorIs(t, DeletePlaygroundConversation(other.Id, created.ID), ErrPlaygroundConversationNotFound)
	require.NoError(t, DeletePlaygroundConversation(owner.Id, created.ID))
	_, _, err = GetPlaygroundConversation(owner.Id, created.ID)
	assert.ErrorIs(t, err, ErrPlaygroundConversationNotFound)
}

func setupPlaygroundConversationRaceTest(t *testing.T) (*gorm.DB, *User) {
	t.Helper()
	dsn := fmt.Sprintf("file:playground-race-%d?mode=memory&cache=shared", time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &PlaygroundConversation{}, &PlaygroundConversationMessage{}))

	previousDB := DB
	previousType := common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		sqlDB, sqlErr := db.DB()
		require.NoError(t, sqlErr)
		require.NoError(t, sqlDB.Close())
	})

	owner := &User{
		Username: "playground-race-owner",
		Password: "unused",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		AffCode:  fmt.Sprintf("pg-race-%d", time.Now().UnixNano()),
	}
	require.NoError(t, db.Create(owner).Error)
	return db, owner
}

func TestGetPlaygroundConversationReturnsSingleRevisionSnapshot(t *testing.T) {
	db, owner := setupPlaygroundConversationRaceTest(t)
	oldPayload := `{"key":"old-message"}`
	newPayload := `{"key":"new-message"}`
	created, err := CreatePlaygroundConversation(owner.Id, "Old title", "model-a", `{}`, `{}`, []string{oldPayload})
	require.NoError(t, err)

	callbackName := fmt.Sprintf("test:playground_get_snapshot_%d", time.Now().UnixNano())
	mutated := false
	var mutationErr error
	require.NoError(t, db.Callback().Query().After("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		if mutated {
			return
		}
		mutated = true
		writeDB := tx.Session(&gorm.Session{NewDB: true, SkipHooks: true, SkipDefaultTransaction: true})
		if err := writeDB.Model(&PlaygroundConversation{}).
			Where("user_id = ? AND id = ?", owner.Id, created.ID).
			Updates(map[string]any{"title": "New title", "revision": int64(2)}).Error; err != nil {
			mutationErr = err
			return
		}
		mutationErr = writeDB.Model(&PlaygroundConversationMessage{}).
			Where("user_id = ? AND conversation_id = ?", owner.Id, created.ID).
			Update("payload", newPayload).Error
	}))
	t.Cleanup(func() {
		require.NoError(t, db.Callback().Query().Remove(callbackName))
	})

	loaded, payloads, err := GetPlaygroundConversation(owner.Id, created.ID)
	require.NoError(t, err)
	require.NoError(t, mutationErr)
	require.True(t, mutated)
	assert.Equal(t, int64(1), loaded.Revision)
	assert.Equal(t, "Old title", loaded.Title)
	assert.Equal(t, []string{oldPayload}, payloads)
}

func TestUpdatePlaygroundConversationReturnsExactCommittedRevision(t *testing.T) {
	db, owner := setupPlaygroundConversationRaceTest(t)
	created, err := CreatePlaygroundConversation(owner.Id, "Initial title", "model-a", `{}`, `{}`, []string{`{"key":"initial"}`})
	require.NoError(t, err)

	callbackName := fmt.Sprintf("test:playground_update_snapshot_%d", time.Now().UnixNano())
	queryCount := 0
	var mutationErr error
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(callbackName, func(tx *gorm.DB) {
		queryCount++
		if queryCount != 2 {
			return
		}
		writeDB := tx.Session(&gorm.Session{NewDB: true, SkipHooks: true, SkipDefaultTransaction: true})
		if err := writeDB.Model(&PlaygroundConversation{}).
			Where("user_id = ? AND id = ?", owner.Id, created.ID).
			Updates(map[string]any{"title": "Concurrent title", "revision": int64(3)}).Error; err != nil {
			mutationErr = err
			return
		}
		mutationErr = writeDB.Model(&PlaygroundConversationMessage{}).
			Where("user_id = ? AND conversation_id = ?", owner.Id, created.ID).
			Update("payload", `{"key":"concurrent"}`).Error
	}))
	t.Cleanup(func() {
		require.NoError(t, db.Callback().Query().Remove(callbackName))
	})

	title := "Committed title"
	updatedPayloads := []string{`{"key":"committed"}`}
	updated, payloads, err := UpdatePlaygroundConversation(owner.Id, created.ID, created.Revision, PlaygroundConversationUpdate{
		Title:    &title,
		Messages: &updatedPayloads,
	})
	require.NoError(t, err)
	require.NoError(t, mutationErr)
	assert.Equal(t, int64(2), updated.Revision)
	assert.Equal(t, title, updated.Title)
	assert.Equal(t, updatedPayloads, payloads)
	assert.Equal(t, 1, queryCount)
}

func TestPlaygroundConversationRejectsOversizedMessages(t *testing.T) {
	assert.ErrorIs(t, validatePlaygroundMessagePayloads([]string{""}), ErrPlaygroundConversationInvalid)
	assert.ErrorIs(t, validatePlaygroundMessagePayloads([]string{strings.Repeat("x", PlaygroundConversationMaxMessageBytes+1)}), ErrPlaygroundConversationInvalid)
	assert.ErrorIs(t, validatePlaygroundMessagePayloads(make([]string, PlaygroundConversationMaxMessages+1)), ErrPlaygroundConversationInvalid)
	aggregate := make([]string, PlaygroundConversationMaxMessagesBytes/PlaygroundConversationMaxMessageBytes+1)
	for i := range aggregate {
		aggregate[i] = strings.Repeat("x", PlaygroundConversationMaxMessageBytes)
	}
	assert.ErrorIs(t, validatePlaygroundMessagePayloads(aggregate), ErrPlaygroundConversationInvalid)
}

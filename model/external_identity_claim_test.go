package model

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestExternalIdentityClaimEnforcesSingleOwnerAtomically(t *testing.T) {
	truncateTables(t)

	first := User{Username: "telegram-owner-one", Password: "password", AffCode: "telegram-owner-one"}
	second := User{Username: "telegram-owner-two", Password: "password", AffCode: "telegram-owner-two"}
	require.NoError(t, DB.Create(&first).Error)
	require.NoError(t, DB.Create(&second).Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, "telegram-123", first.Id)
	}))
	err := DB.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, "telegram-123", second.Id)
	})
	assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)

	err = DB.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, "telegram-456", first.Id)
	})
	assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)

	var claims []ExternalIdentityClaim
	require.NoError(t, DB.Find(&claims).Error)
	require.Len(t, claims, 1)
	assert.Equal(t, first.Id, claims[0].UserId)
	assert.Equal(t, "telegram-123", claims[0].Subject)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return ReleaseExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, first.Id)
	}))
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, "telegram-123", second.Id)
	}))
}

func TestClearExternalIdentityBindingReleasesIdentityClaim(t *testing.T) {
	for _, provider := range []string{ExternalIdentityProviderTelegram, ExternalIdentityProviderWeChat} {
		t.Run(provider, func(t *testing.T) {
			truncateTables(t)

			user := User{Username: provider + "-unbind", Password: "password"}
			subject := provider + "-unbind-id"
			if provider == ExternalIdentityProviderTelegram {
				user.TelegramId = subject
			} else {
				user.WeChatId = subject
			}
			require.NoError(t, DB.Create(&user).Error)
			require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
				return ClaimExternalIdentityWithTx(tx, provider, subject, user.Id)
			}))

			require.NoError(t, user.ClearBinding(provider))
			assert.Empty(t, user.TelegramId)
			assert.Empty(t, user.WeChatId)

			var count int64
			require.NoError(t, DB.Model(&ExternalIdentityClaim{}).Where("user_id = ?", user.Id).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestInitializeExternalIdentityClaimsIsIdempotent(t *testing.T) {
	truncateTables(t)

	user := User{
		Username:   "external-legacy",
		Password:   "password",
		TelegramId: "telegram-legacy-id",
		WeChatId:   "wechat-legacy-id",
	}
	require.NoError(t, DB.Create(&user).Error)
	require.NoError(t, InitializeExternalIdentityClaims())
	require.NoError(t, InitializeExternalIdentityClaims())

	for provider, subject := range map[string]string{
		ExternalIdentityProviderTelegram: user.TelegramId,
		ExternalIdentityProviderWeChat:   user.WeChatId,
	} {
		var claim ExternalIdentityClaim
		require.NoError(t, DB.Where("provider = ? AND subject = ?", provider, subject).First(&claim).Error)
		assert.Equal(t, user.Id, claim.UserId)
	}
	var count int64
	require.NoError(t, DB.Model(&ExternalIdentityClaim{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestInitializeExternalIdentityClaimsRejectsAmbiguousLegacyBindings(t *testing.T) {
	for _, provider := range []string{ExternalIdentityProviderTelegram, ExternalIdentityProviderWeChat} {
		t.Run(provider, func(t *testing.T) {
			truncateTables(t)

			first := User{Username: provider + "-legacy-one", Password: "password", AffCode: provider + "-one"}
			second := User{Username: provider + "-legacy-two", Password: "password", AffCode: provider + "-two"}
			if provider == ExternalIdentityProviderTelegram {
				first.TelegramId, second.TelegramId = "duplicate-external-id", "duplicate-external-id"
			} else {
				first.WeChatId, second.WeChatId = "duplicate-external-id", "duplicate-external-id"
			}
			require.NoError(t, DB.Create(&first).Error)
			require.NoError(t, DB.Create(&second).Error)

			err := InitializeExternalIdentityClaims()
			assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)

			var count int64
			require.NoError(t, DB.Model(&ExternalIdentityClaim{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func testExternalIdentityClaimMigration(t *testing.T, db *gorm.DB) {
	t.Helper()

	// Exercise a fresh migration twice before recreating the latest released
	// schema, which did not yet contain the ownership table.
	require.NoError(t, db.AutoMigrate(&User{}, &ExternalIdentityClaim{}))
	require.NoError(t, db.AutoMigrate(&User{}, &ExternalIdentityClaim{}))
	require.True(t, db.Migrator().HasTable(&ExternalIdentityClaim{}))
	require.NoError(t, db.Migrator().DropTable(&ExternalIdentityClaim{}))
	require.False(t, db.Migrator().HasTable(&ExternalIdentityClaim{}))

	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	telegramUser := User{
		Username:   "claim-tg-" + suffix,
		Password:   "unused-password",
		AffCode:    "ctg-" + suffix,
		TelegramId: "telegram-" + suffix,
		Quota:      123,
	}
	wechatUser := User{
		Username: "claim-wx-" + suffix,
		Password: "unused-password",
		AffCode:  "cwx-" + suffix,
		WeChatId: "wechat-" + suffix,
		Quota:    456,
	}
	competitor := User{
		Username: "claim-other-" + suffix,
		Password: "unused-password",
		AffCode:  "cot-" + suffix,
	}
	require.NoError(t, db.Create(&telegramUser).Error)
	require.NoError(t, db.Create(&wechatUser).Error)
	require.NoError(t, db.Create(&competitor).Error)
	userIDs := []int{telegramUser.Id, wechatUser.Id, competitor.Id}
	t.Cleanup(func() {
		require.NoError(t, db.Where("user_id IN ?", userIDs).Delete(&ExternalIdentityClaim{}).Error)
		require.NoError(t, db.Unscoped().Where("id IN ?", userIDs).Delete(&User{}).Error)
	})

	// Upgrade the representative legacy database and prove startup migration is
	// idempotent while preserving the existing users and their balances.
	require.NoError(t, db.AutoMigrate(&ExternalIdentityClaim{}))
	require.NoError(t, db.AutoMigrate(&ExternalIdentityClaim{}))
	previousDB := DB
	DB = db
	t.Cleanup(func() { DB = previousDB })
	require.NoError(t, InitializeExternalIdentityClaims())
	require.NoError(t, InitializeExternalIdentityClaims())

	for _, expected := range []ExternalIdentityClaim{
		{Provider: ExternalIdentityProviderTelegram, Subject: telegramUser.TelegramId, UserId: telegramUser.Id},
		{Provider: ExternalIdentityProviderWeChat, Subject: wechatUser.WeChatId, UserId: wechatUser.Id},
	} {
		var claim ExternalIdentityClaim
		require.NoError(t, db.Where("provider = ? AND subject = ?", expected.Provider, expected.Subject).First(&claim).Error)
		assert.Equal(t, expected.UserId, claim.UserId)
	}
	var storedTelegram User
	require.NoError(t, db.First(&storedTelegram, telegramUser.Id).Error)
	assert.Equal(t, telegramUser.TelegramId, storedTelegram.TelegramId)
	assert.Equal(t, 123, storedTelegram.Quota)
	var storedWeChat User
	require.NoError(t, db.First(&storedWeChat, wechatUser.Id).Error)
	assert.Equal(t, wechatUser.WeChatId, storedWeChat.WeChatId)
	assert.Equal(t, 456, storedWeChat.Quota)

	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, telegramUser.TelegramId, telegramUser.Id)
	}))
	err := db.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, telegramUser.TelegramId, competitor.Id)
	})
	assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)
	err = db.Transaction(func(tx *gorm.DB) error {
		return ClaimExternalIdentityWithTx(tx, ExternalIdentityProviderTelegram, "other-"+suffix, telegramUser.Id)
	})
	assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)

	var claimCount int64
	require.NoError(t, db.Model(&ExternalIdentityClaim{}).Count(&claimCount).Error)
	assert.EqualValues(t, 2, claimCount)

	// A legacy collision must roll back the complete backfill, including claims
	// created for otherwise valid users earlier in the same transaction.
	require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ExternalIdentityClaim{}).Error)
	ambiguousSubject := "ambiguous-" + suffix
	firstAmbiguous := User{
		Username:   "claim-ambiguous-one-" + suffix,
		Password:   "unused-password",
		AffCode:    "ca1-" + suffix,
		TelegramId: ambiguousSubject,
	}
	secondAmbiguous := User{
		Username:   "claim-ambiguous-two-" + suffix,
		Password:   "unused-password",
		AffCode:    "ca2-" + suffix,
		TelegramId: ambiguousSubject,
	}
	require.NoError(t, db.Create(&firstAmbiguous).Error)
	require.NoError(t, db.Create(&secondAmbiguous).Error)
	userIDs = append(userIDs, firstAmbiguous.Id, secondAmbiguous.Id)

	err = InitializeExternalIdentityClaims()
	assert.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)
	require.NoError(t, db.Model(&ExternalIdentityClaim{}).Count(&claimCount).Error)
	assert.Zero(t, claimCount)
	var preserved int64
	require.NoError(t, db.Model(&User{}).Where("id IN ?", []int{firstAmbiguous.Id, secondAmbiguous.Id}).Count(&preserved).Error)
	assert.EqualValues(t, 2, preserved)
}

func TestExternalIdentityClaimMigrationSQLite(t *testing.T) {
	databasePath := filepath.ToSlash(filepath.Join(t.TempDir(), "external-identity-claim.db"))
	db, err := gorm.Open(sqlite.Open(databasePath+"?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testExternalIdentityClaimMigration(t, db)
}

func TestExternalIdentityClaimMigrationMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testExternalIdentityClaimMigration(t, db)
}

func TestExternalIdentityClaimMigrationPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testExternalIdentityClaimMigration(t, db)
}

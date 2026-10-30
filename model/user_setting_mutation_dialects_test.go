package model

import (
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testMutateUserSettingOnDatabase(t *testing.T, db *gorm.DB, databaseType common.DatabaseType) {
	t.Helper()
	if db.Migrator().HasTable(&User{}) {
		t.Skip("refusing to use an external database that already contains the users table")
	}

	originalDB := DB
	originalMainType := common.MainDatabaseType()
	originalLogType := common.LogDatabaseType()
	DB = db
	common.SetDatabaseTypes(databaseType, databaseType)
	initCol()
	t.Cleanup(func() {
		_ = db.Migrator().DropTable(&User{})
		DB = originalDB
		common.SetDatabaseTypes(originalMainType, originalLogType)
		initCol()
	})

	require.NoError(t, db.AutoMigrate(&User{}))
	user := User{Username: "routing-setting-dialect", Password: "password", Status: common.UserStatusEnabled}
	user.SetSetting(dto.UserSetting{Language: "ru", RoutingSources: map[string]string{"gpt": "default"}})
	require.NoError(t, db.Create(&user).Error)

	require.NoError(t, MutateUserSetting(user.Id, func(setting *dto.UserSetting) error {
		setting.RoutingSources["gpt"] = "premium"
		return nil
	}))
	require.NoError(t, MutateUserSetting(user.Id, func(setting *dto.UserSetting) error {
		setting.BillingPreference = "wallet"
		return nil
	}))

	var stored User
	require.NoError(t, db.First(&stored, user.Id).Error)
	settings := stored.GetSetting()
	assert.Equal(t, "ru", settings.Language)
	assert.Equal(t, "premium", settings.RoutingSources["gpt"])
	assert.Equal(t, "wallet", settings.BillingPreference)
}

func TestMutateUserSettingConfiguredDatabases(t *testing.T) {
	tests := []struct {
		name      string
		env       string
		dbType    common.DatabaseType
		dialector func(string) gorm.Dialector
	}{
		{
			name:   "mysql",
			env:    "TEST_MYSQL_DSN",
			dbType: common.DatabaseTypeMySQL,
			dialector: func(dsn string) gorm.Dialector {
				return mysql.Open(dsn)
			},
		},
		{
			name:   "postgres",
			env:    "TEST_POSTGRES_DSN",
			dbType: common.DatabaseTypePostgreSQL,
			dialector: func(dsn string) gorm.Dialector {
				return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := strings.TrimSpace(os.Getenv(test.env))
			if dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			db, err := gorm.Open(test.dialector(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			testMutateUserSettingOnDatabase(t, db, test.dbType)
		})
	}
}

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

func testUserQuotaFreshSchema(t *testing.T, db *gorm.DB, dbType common.DatabaseType) {
	t.Helper()
	tableName := fmt.Sprintf("user_quota_schema_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })
	tableDB := db.Table(tableName)

	require.NoError(t, tableDB.AutoMigrate(&User{}))
	require.NoError(t, tableDB.AutoMigrate(&User{}))

	columnTypes, err := tableDB.Migrator().ColumnTypes(&User{})
	require.NoError(t, err)
	actualTypes := make(map[string]string, len(columnTypes))
	for _, columnType := range columnTypes {
		actualTypes[strings.ToLower(columnType.Name())] = columnType.DatabaseTypeName()
	}
	for _, columnName := range userQuotaColumns {
		dataType, ok := actualTypes[columnName]
		require.True(t, ok, "users.%s must exist", columnName)
		if dbType == common.DatabaseTypeSQLite {
			assert.Equal(t, "bigint", strings.ToLower(dataType), "users.%s must declare 64-bit storage", columnName)
			continue
		}
		assert.True(t, is64BitIntegerType(dbType, dataType), "users.%s uses %s", columnName, dataType)
	}

	const quotaBeyondInt32 = int(1<<32 + 17)
	require.NoError(t, tableDB.Create(map[string]any{
		"username":    "large-quota",
		"password":    "not-a-real-password",
		"quota":       quotaBeyondInt32,
		"used_quota":  quotaBeyondInt32 + 1,
		"aff_quota":   quotaBeyondInt32 + 2,
		"aff_history": quotaBeyondInt32 + 3,
	}).Error)

	var stored struct {
		Quota      int
		UsedQuota  int `gorm:"column:used_quota"`
		AffQuota   int `gorm:"column:aff_quota"`
		AffHistory int `gorm:"column:aff_history"`
	}
	require.NoError(t, tableDB.Model(&User{}).
		Select("quota", "used_quota", "aff_quota", "aff_history").
		Take(&stored).Error)
	assert.Equal(t, quotaBeyondInt32, stored.Quota)
	assert.Equal(t, quotaBeyondInt32+1, stored.UsedQuota)
	assert.Equal(t, quotaBeyondInt32+2, stored.AffQuota)
	assert.Equal(t, quotaBeyondInt32+3, stored.AffHistory)
}

func TestUserQuotaFreshSchemaSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testUserQuotaFreshSchema(t, db, common.DatabaseTypeSQLite)
}

func TestUserQuotaFreshSchemaConfiguredDatabases(t *testing.T) {
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
			testUserQuotaFreshSchema(t, db, test.dbType)
		})
	}
}

/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.
*/
package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateUserTokenClassifiesResellerQuotaFailures(t *testing.T) {
	truncateTables(t)

	tests := []struct {
		name        string
		key         string
		quotaMode   string
		status      int
		remainQuota int
		wantErr     error
		wantStatus  int
	}{
		{
			name:       "reseller reservation is quota unavailable",
			key:        "rsl_held",
			quotaMode:  TokenQuotaModeTokens,
			status:     common.TokenStatusEnabled,
			wantErr:    ErrResellerTokenQuotaInsufficient,
			wantStatus: common.TokenStatusEnabled,
		},
		{
			name:        "exhausted reseller status is quota unavailable",
			key:         "rsl_exhausted",
			quotaMode:   TokenQuotaModeTokens,
			status:      common.TokenStatusExhausted,
			remainQuota: 1,
			wantErr:     ErrResellerTokenQuotaInsufficient,
			wantStatus:  common.TokenStatusExhausted,
		},
		{
			name:       "ordinary raw-token key keeps legacy invalid response",
			key:        "ordinary_raw",
			quotaMode:  TokenQuotaModeTokens,
			status:     common.TokenStatusEnabled,
			wantErr:    ErrTokenInvalid,
			wantStatus: common.TokenStatusEnabled,
		},
		{
			name:       "ordinary money key keeps legacy exhausted status",
			key:        "ordinary_money",
			quotaMode:  TokenQuotaModeMoney,
			status:     common.TokenStatusEnabled,
			wantErr:    ErrTokenInvalid,
			wantStatus: common.TokenStatusExhausted,
		},
	}

	for index, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			token := &Token{
				Id:             900 + index,
				UserId:         1,
				Key:            testCase.key,
				Name:           testCase.name,
				Status:         testCase.status,
				ExpiredTime:    -1,
				RemainQuota:    testCase.remainQuota,
				UnlimitedQuota: false,
				QuotaMode:      testCase.quotaMode,
			}
			require.NoError(t, DB.Create(token).Error)

			validated, err := ValidateUserToken(testCase.key)
			require.Error(t, err)
			assert.ErrorIs(t, err, testCase.wantErr)
			require.NotNil(t, validated)

			var stored Token
			require.NoError(t, DB.First(&stored, token.Id).Error)
			assert.Equal(t, testCase.wantStatus, stored.Status)
		})
	}
}

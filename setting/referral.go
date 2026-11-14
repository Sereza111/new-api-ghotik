package setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const DefaultReferralTopUpRewardPercent = 5.0

var ReferralTopUpRewardPercent = DefaultReferralTopUpRewardPercent

func ValidateReferralTopUpRewardPercent(value string) error {
	percent, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(percent) || math.IsInf(percent, 0) || percent < 0 || percent > 100 {
		return fmt.Errorf("referral top-up reward percent must be between 0 and 100")
	}
	return nil
}

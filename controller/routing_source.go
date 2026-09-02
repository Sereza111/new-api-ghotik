package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type updateRoutingSourceRequest struct {
	SourceID string `json:"source_id"`
}

func GetRoutingSources(c *gin.Context) {
	userID := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	settings, err := model.GetUserSetting(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, service.GetRoutingSourceCatalog(userGroup, settings))
}

func UpdateRoutingSource(c *gin.Context) {
	userID := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	family := strings.ToLower(strings.TrimSpace(c.Param("family")))
	var request updateRoutingSourceRequest
	if family == "" || c.ShouldBindJSON(&request) != nil {
		common.ApiErrorMsg(c, "Invalid routing source request")
		return
	}
	request.SourceID = strings.TrimSpace(request.SourceID)
	settings, err := model.GetUserSetting(userID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	catalog := service.GetRoutingSourceCatalog(userGroup, settings)
	if !service.RoutingSourceAvailable(catalog, family, request.SourceID) {
		common.ApiErrorMsg(c, "Routing source is not available for this model family")
		return
	}

	err = model.MutateUserSetting(userID, func(current *dto.UserSetting) error {
		if current.RoutingSources == nil {
			current.RoutingSources = make(map[string]string)
		}
		current.RoutingSources[family] = request.SourceID
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	settings, err = model.GetUserSetting(userID, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, service.GetRoutingSourceCatalog(userGroup, settings))
}

func DeleteRoutingSource(c *gin.Context) {
	userID := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	family := strings.ToLower(strings.TrimSpace(c.Param("family")))
	if family == "" {
		common.ApiErrorMsg(c, "Invalid model family")
		return
	}

	err := model.MutateUserSetting(userID, func(current *dto.UserSetting) error {
		delete(current.RoutingSources, family)
		if len(current.RoutingSources) == 0 {
			current.RoutingSources = nil
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	settings, err := model.GetUserSetting(userID, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, service.GetRoutingSourceCatalog(userGroup, settings))
}

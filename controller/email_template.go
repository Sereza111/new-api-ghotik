package controller

import (
	"bytes"
	"html/template"
)

type authEmailData struct {
	SystemName   string
	PreviewText  string
	Eyebrow      string
	Title        string
	Description  string
	Code         string
	ActionURL    string
	ActionLabel  string
	FallbackText string
	ValidMinutes int
	ServerURL    string
}

var authEmailTemplate = template.Must(template.New("auth-email").Parse(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark light">
    <meta name="supported-color-schemes" content="dark light">
    <title>{{.Title}}</title>
  </head>
  <body style="margin:0;padding:0;background:#070a0c;color:#e7edf0;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{{.PreviewText}}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#070a0c;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#0c1114;border:1px solid #27343a;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #27343a;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;color:#f2f4f3;">{{.SystemName}}</td>
                    <td align="right" style="font-size:11px;line-height:16px;text-transform:uppercase;color:#91cbe3;">Безопасный доступ</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 32px 32px;">
                <div style="margin-bottom:12px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#91cbe3;">{{.Eyebrow}}</div>
                <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:40px;color:#f2f4f3;">{{.Title}}</h1>
                <p style="margin:0 0 28px;font-size:16px;line-height:25px;color:#aeb9be;">{{.Description}}</p>
                {{if .Code}}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;width:100%;background:#080c0e;border:1px solid #3e5965;">
                  <tr>
                    <td align="center" style="padding:24px 12px;font-family:'Courier New',Courier,monospace;font-size:30px;line-height:36px;font-weight:700;letter-spacing:8px;color:#b4e3f6;">{{.Code}}</td>
                  </tr>
                </table>
                {{end}}
                {{if .ActionURL}}
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                  <tr>
                    <td bgcolor="#a9d9ec" style="background:#a9d9ec;">
                      <a href="{{.ActionURL}}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#071014;text-decoration:none;">{{.ActionLabel}}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 24px;font-size:12px;line-height:19px;color:#7f8d93;">{{.FallbackText}}<br><a href="{{.ActionURL}}" style="color:#91cbe3;word-break:break-all;">{{.ActionURL}}</a></p>
                {{end}}
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#10181c;border-left:3px solid #91cbe3;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:20px;color:#aeb9be;">Данные действительны {{.ValidMinutes}} минут. Никому их не сообщайте. Если вы не запрашивали это действие, просто проигнорируйте письмо.</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #27343a;font-size:12px;line-height:18px;color:#6f7c82;">
                Это автоматическое письмо от {{.SystemName}}. Ответ на него не требуется.
                {{if .ServerURL}}<br><a href="{{.ServerURL}}" style="color:#91cbe3;text-decoration:none;">{{.ServerURL}}</a>{{end}}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`))

func renderAuthEmail(data authEmailData) (string, error) {
	var output bytes.Buffer
	if err := authEmailTemplate.Execute(&output, data); err != nil {
		return "", err
	}
	return output.String(), nil
}

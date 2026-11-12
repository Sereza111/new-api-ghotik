package media

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/relaykit/types"
)

type MediaResolver struct {
	GetBase64Data        func(c context.Context, source types.FileSource, reason ...string) (string, string, error)
	DecodeBase64FileData func(base64String string) (string, string, error)
}

var (
	mediaResolverMu sync.RWMutex
	mediaResolver   MediaResolver
)

func SetMediaResolver(resolver MediaResolver) {
	mediaResolverMu.Lock()
	defer mediaResolverMu.Unlock()

	mediaResolver = resolver
}

func ResolveBase64Data(c context.Context, source types.FileSource, reason ...string) (string, string, error) {
	mediaResolverMu.RLock()
	resolver := mediaResolver.GetBase64Data
	mediaResolverMu.RUnlock()
	if resolver == nil {
		return "", "", errors.New("relayconvert media resolver is not configured")
	}
	return resolver(c, source, reason...)
}

func DecodeBase64FileData(base64String string) (string, string, error) {
	mediaResolverMu.RLock()
	resolver := mediaResolver.DecodeBase64FileData
	mediaResolverMu.RUnlock()
	if resolver == nil {
		return "", "", errors.New("relayconvert media resolver is not configured")
	}
	return resolver(base64String)
}

// DefaultResponsesImageDetail is used when the source protocol carries no detail
// hint. Sending the default explicitly also supports strict Responses validators
// that reject input_image parts without detail.
const DefaultResponsesImageDetail = "auto"

const (
	DOCXMimeType           = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	maxDOCXCompressedBytes = 16 << 20
	maxDOCXDocumentBytes   = 32 << 20
	maxDOCXArchiveEntries  = 2048
)

// ResponsesImageDetail preserves supported image detail levels and defaults
// missing or unrecognized hints to "auto".
func ResponsesImageDetail(detail string) string {
	switch normalized := strings.ToLower(strings.TrimSpace(detail)); normalized {
	case "low", "high", "auto", "original":
		return normalized
	default:
		return DefaultResponsesImageDetail
	}
}

// IsTextMimeType reports whether a MIME type is plain text that a target can
// carry as text: text/* and application/json, ignoring parameters.
func IsTextMimeType(mimeType string) bool {
	mediaType, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(mimeType)), ";")
	mediaType = strings.TrimSpace(mediaType)
	return strings.HasPrefix(mediaType, "text/") || mediaType == "application/json"
}

// IsDOCXMimeType reports whether a MIME type identifies an Office Open XML
// word-processing document, ignoring MIME parameters.
func IsDOCXMimeType(mimeType string) bool {
	mediaType, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(mimeType)), ";")
	return strings.TrimSpace(mediaType) == DOCXMimeType
}

// DecodeText decodes base64 file data as text. It reports false when the data
// is not valid base64 or the bytes are not UTF-8.
func DecodeText(base64Data string) (string, bool) {
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(base64Data))
	if err != nil || !utf8.Valid(decoded) {
		return "", false
	}
	return string(decoded), true
}

// DecodeDOCX extracts readable text from the main WordprocessingML document.
// Archive and XML limits keep malformed documents and zip bombs from causing
// unbounded memory use during request conversion.
func DecodeDOCX(base64Data string) (string, error) {
	base64Data = strings.TrimSpace(base64Data)
	if base64.StdEncoding.DecodedLen(len(base64Data)) > maxDOCXCompressedBytes {
		return "", fmt.Errorf("DOCX archive exceeds the %d-byte limit", maxDOCXCompressedBytes)
	}

	archiveData, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("decode DOCX base64: %w", err)
	}
	if len(archiveData) > maxDOCXCompressedBytes {
		return "", fmt.Errorf("DOCX archive exceeds the %d-byte limit", maxDOCXCompressedBytes)
	}

	archive, err := zip.NewReader(bytes.NewReader(archiveData), int64(len(archiveData)))
	if err != nil {
		return "", fmt.Errorf("open DOCX archive: %w", err)
	}
	if len(archive.File) > maxDOCXArchiveEntries {
		return "", fmt.Errorf("DOCX archive contains too many entries")
	}

	var document *zip.File
	for _, file := range archive.File {
		if file.Name == "word/document.xml" {
			document = file
			break
		}
	}
	if document == nil {
		return "", errors.New("DOCX archive is missing word/document.xml")
	}
	if document.UncompressedSize64 > maxDOCXDocumentBytes {
		return "", fmt.Errorf("DOCX document XML exceeds the %d-byte limit", maxDOCXDocumentBytes)
	}

	documentReader, err := document.Open()
	if err != nil {
		return "", fmt.Errorf("open DOCX document XML: %w", err)
	}
	defer documentReader.Close()

	documentXML, err := io.ReadAll(io.LimitReader(documentReader, maxDOCXDocumentBytes+1))
	if err != nil {
		return "", fmt.Errorf("read DOCX document XML: %w", err)
	}
	if len(documentXML) > maxDOCXDocumentBytes {
		return "", fmt.Errorf("DOCX document XML exceeds the %d-byte limit", maxDOCXDocumentBytes)
	}

	decoder := xml.NewDecoder(bytes.NewReader(documentXML))
	var text strings.Builder
	text.Grow(min(len(documentXML), 64<<10))
	textDepth := 0
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("parse DOCX document XML: %w", err)
		}

		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "t":
				textDepth++
			case "tab":
				if text.Len()+1 > maxDOCXDocumentBytes {
					return "", errors.New("extracted DOCX text exceeds the size limit")
				}
				text.WriteByte('\t')
			case "br", "cr":
				if text.Len()+1 > maxDOCXDocumentBytes {
					return "", errors.New("extracted DOCX text exceeds the size limit")
				}
				text.WriteByte('\n')
			}
		case xml.CharData:
			if textDepth == 0 {
				continue
			}
			if text.Len()+len(value) > maxDOCXDocumentBytes {
				return "", errors.New("extracted DOCX text exceeds the size limit")
			}
			text.Write(value)
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				if textDepth > 0 {
					textDepth--
				}
			case "p":
				if text.Len()+1 > maxDOCXDocumentBytes {
					return "", errors.New("extracted DOCX text exceeds the size limit")
				}
				text.WriteByte('\n')
			}
		}
	}

	extracted := strings.TrimSpace(text.String())
	if extracted == "" {
		return "", errors.New("DOCX document contains no extractable text")
	}
	return extracted, nil
}

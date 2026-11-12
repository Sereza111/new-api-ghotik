package media_test

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"io"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/relayconvert/internal/media"
	sharedclaude "github.com/QuantumNous/new-api/relaykit/relayconvert/internal/shared/claude"
	sharedgemini "github.com/QuantumNous/new-api/relaykit/relayconvert/internal/shared/gemini"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecodeDOCX(t *testing.T) {
	document := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello</w:t><w:tab/><w:t>world</w:t><w:br/><w:t>next line</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">  second paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`

	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	documentWriter, err := writer.Create("word/document.xml")
	require.NoError(t, err)
	_, err = io.WriteString(documentWriter, document)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	encoded := base64.StdEncoding.EncodeToString(archive.Bytes())
	got, err := media.DecodeDOCX(encoded)
	require.NoError(t, err)
	assert.Equal(t, "Hello\tworld\nnext line\n  second paragraph", got)
	assert.True(t, media.IsDOCXMimeType(media.DOCXMimeType+"; charset=binary"))

	claudeBlock, reason := sharedclaude.MediaBlock(encoded, media.DOCXMimeType, false)
	require.Empty(t, reason)
	require.NotNil(t, claudeBlock.Source)
	assert.Equal(t, "document", claudeBlock.Type)
	assert.Equal(t, "text", claudeBlock.Source.Type)
	assert.Equal(t, got, claudeBlock.Source.Data)

	geminiPart, supported, err := sharedgemini.ResolvedMediaPart(encoded, media.DOCXMimeType)
	require.NoError(t, err)
	assert.True(t, supported)
	assert.Equal(t, got, geminiPart.Text)
	assert.Nil(t, geminiPart.InlineData)
}

func TestDecodeDOCXRejectsMalformedDocuments(t *testing.T) {
	tests := []struct {
		name string
		data string
		want string
	}{
		{name: "invalid base64", data: "%%%", want: "decode DOCX base64"},
		{name: "not a zip archive", data: base64.StdEncoding.EncodeToString([]byte("not a zip")), want: "open DOCX archive"},
		{name: "missing document XML", data: emptyDOCXArchive(t), want: "missing word/document.xml"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := media.DecodeDOCX(test.data)
			require.Error(t, err)
			assert.ErrorContains(t, err, test.want)
		})
	}
}

func emptyDOCXArchive(t *testing.T) string {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	require.NoError(t, writer.Close())
	return base64.StdEncoding.EncodeToString(archive.Bytes())
}

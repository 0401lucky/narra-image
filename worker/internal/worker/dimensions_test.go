package worker

import (
	"bytes"
	"testing"
)

func TestReadImageDimensionsPNG(t *testing.T) {
	header := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	chunkLength := []byte{0x00, 0x00, 0x00, 0x0d}
	chunkType := []byte("IHDR")
	data := make([]byte, 13)
	data[0], data[1], data[2], data[3] = 0x00, 0x00, 0x04, 0x00
	data[4], data[5], data[6], data[7] = 0x00, 0x00, 0x03, 0x00
	data[8] = 8

	buffer := bytes.Join([][]byte{
		header,
		chunkLength,
		chunkType,
		data,
		make([]byte, 4),
	}, nil)

	dimensions := readImageDimensions(buffer)
	if dimensions == nil {
		t.Fatal("expected dimensions")
	}
	if dimensions.Width != 1024 || dimensions.Height != 768 {
		t.Fatalf("unexpected dimensions: %+v", dimensions)
	}
}

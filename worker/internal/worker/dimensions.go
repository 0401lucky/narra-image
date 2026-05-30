package worker

import (
	"bytes"
	"encoding/binary"
)

type ImageDimensions struct {
	Height int
	Width  int
}

var (
	pngMagic   = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}
	riffMagic  = []byte("RIFF")
	webpMagic  = []byte("WEBP")
	gifMagic87 = []byte("GIF87a")
	gifMagic89 = []byte("GIF89a")
)

func readImageDimensions(buffer []byte) *ImageDimensions {
	if dimensions := readPNG(buffer); dimensions != nil {
		return dimensions
	}
	if dimensions := readJPEG(buffer); dimensions != nil {
		return dimensions
	}
	if dimensions := readWebP(buffer); dimensions != nil {
		return dimensions
	}
	if dimensions := readGIF(buffer); dimensions != nil {
		return dimensions
	}
	return nil
}

func readPNG(buffer []byte) *ImageDimensions {
	if len(buffer) < 24 || !bytes.Equal(buffer[:8], pngMagic) {
		return nil
	}
	width := int(binary.BigEndian.Uint32(buffer[16:20]))
	height := int(binary.BigEndian.Uint32(buffer[20:24]))
	if width <= 0 || height <= 0 {
		return nil
	}
	return &ImageDimensions{Height: height, Width: width}
}

func readJPEG(buffer []byte) *ImageDimensions {
	if len(buffer) < 4 || buffer[0] != 0xff || buffer[1] != 0xd8 {
		return nil
	}

	offset := 2
	for offset+9 < len(buffer) {
		if buffer[offset] != 0xff {
			return nil
		}
		marker := buffer[offset+1]
		offset += 2

		isStartOfFrame := marker >= 0xc0 && marker <= 0xcf &&
			marker != 0xc4 && marker != 0xc8 && marker != 0xcc
		segmentLength := int(binary.BigEndian.Uint16(buffer[offset : offset+2]))
		if isStartOfFrame {
			if offset+7 > len(buffer) {
				return nil
			}
			height := int(binary.BigEndian.Uint16(buffer[offset+3 : offset+5]))
			width := int(binary.BigEndian.Uint16(buffer[offset+5 : offset+7]))
			if width <= 0 || height <= 0 {
				return nil
			}
			return &ImageDimensions{Height: height, Width: width}
		}
		offset += segmentLength
	}
	return nil
}

func readWebP(buffer []byte) *ImageDimensions {
	if len(buffer) < 30 || !bytes.Equal(buffer[:4], riffMagic) || !bytes.Equal(buffer[8:12], webpMagic) {
		return nil
	}

	fourCC := string(buffer[12:16])
	switch fourCC {
	case "VP8 ":
		width := int(binary.LittleEndian.Uint16(buffer[26:28]) & 0x3fff)
		height := int(binary.LittleEndian.Uint16(buffer[28:30]) & 0x3fff)
		if width > 0 && height > 0 {
			return &ImageDimensions{Height: height, Width: width}
		}
	case "VP8L":
		if buffer[20] != 0x2f {
			return nil
		}
		bits := uint32(buffer[21]) | uint32(buffer[22])<<8 | uint32(buffer[23])<<16 | uint32(buffer[24])<<24
		width := int(bits&0x3fff) + 1
		height := int((bits>>14)&0x3fff) + 1
		if width > 0 && height > 0 {
			return &ImageDimensions{Height: height, Width: width}
		}
	case "VP8X":
		width := int(uint32(buffer[24])|uint32(buffer[25])<<8|uint32(buffer[26])<<16) + 1
		height := int(uint32(buffer[27])|uint32(buffer[28])<<8|uint32(buffer[29])<<16) + 1
		if width > 0 && height > 0 {
			return &ImageDimensions{Height: height, Width: width}
		}
	}
	return nil
}

func readGIF(buffer []byte) *ImageDimensions {
	if len(buffer) < 10 || (!bytes.Equal(buffer[:6], gifMagic87) && !bytes.Equal(buffer[:6], gifMagic89)) {
		return nil
	}
	width := int(binary.LittleEndian.Uint16(buffer[6:8]))
	height := int(binary.LittleEndian.Uint16(buffer[8:10]))
	if width <= 0 || height <= 0 {
		return nil
	}
	return &ImageDimensions{Height: height, Width: width}
}

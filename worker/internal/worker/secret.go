package worker

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

func decryptProviderSecret(value string, secret string) (string, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return "", errors.New("渠道密钥格式无效")
	}

	iv, err := base64.StdEncoding.DecodeString(parts[0])
	if err != nil {
		return "", err
	}
	encrypted, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}

	digest := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(digest[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	decrypted, err := gcm.Open(nil, iv, encrypted, nil)
	if err != nil {
		return "", err
	}
	return string(decrypted), nil
}

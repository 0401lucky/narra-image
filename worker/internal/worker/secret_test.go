package worker

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestDecryptProviderSecretCompat(t *testing.T) {
	secret := "replace-with-strong-secret"
	plainText := "sk-test"
	iv := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}

	digest := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(digest[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}

	encrypted := gcm.Seal(nil, iv, []byte(plainText), nil)
	value := base64.StdEncoding.EncodeToString(iv) + ":" + base64.StdEncoding.EncodeToString(encrypted)

	got, err := decryptProviderSecret(value, secret)
	if err != nil {
		t.Fatal(err)
	}
	if got != plainText {
		t.Fatalf("unexpected decrypted value: %s", got)
	}
}

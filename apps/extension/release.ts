/**
 * Release builds put this public key in the manifest, which pins the
 * extension ID wherever the folder is loaded from. The private key isn't in
 * the repository. Dev builds leave it out and keep their folder-derived ID.
 */
export const RELEASE_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAytp75PAaF80YVTlCpIV4UO8NROtgach3s9N75S7jhaxec+90/2JZYF9QSCmCcnlG1V1Hl8LBY8QJWcvzMS/Sq6WYkjoIGnzqI9bnzU3UbU9RWOoEwPHSML3ChtYTYzmFoUV6Z/vm7tETVJyMSdPPh2GBYLQ6fZSEQcNk3vfhGoUXIGjZM2Qi2d0vJQYDnhacjfvYFn8s2uW6+fzg8qdX6ykRjtIZVbUBD73M0vhZlMPZyzPGGVqD8bhR1zrmsfO+DtPklm/sVpv10PP19FVTcRJH94XKCb78QQOWyKvJrKHJY09FX+KUl3LNTwBd2CMviHh9huPuzw+8d1hyjTfq3wIDAQAB";

/** The ID Chromium derives from `RELEASE_KEY`. `pnpm test` checks they match. */
export const RELEASE_EXTENSION_ID = "kidgkbpjficoclfmfidbipkjdkiikklb";

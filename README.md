# solana-token-faucet

Rate-limited SPL token faucet with per-wallet cooldown enforcement on Solana.

\![Rust](https://img.shields.io/badge/Rust-000000?logo=rust) \![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white) \![Anchor](https://img.shields.io/badge/Anchor-blue) \![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Overview

A Solana Anchor program that distributes SPL tokens at a configurable rate with per-wallet cooldown tracking. Each wallet's claim history is stored on-chain via PDA-derived ClaimRecord accounts, preventing abuse while allowing permissionless token distribution.

## Program Instructions

| Instruction | Description | Key Accounts |
|---|---|---|
| `initialize_faucet` | Create a new faucet for a given mint with configurable claim amount and cooldown period | `authority` (signer), `mint`, `faucet` (PDA), `vault` (PDA token account) |
| `fund_faucet` | Deposit tokens into the faucet vault | `authority` (signer), `faucet`, `vault`, `authority_token_account` |
| `claim_tokens` | Claim tokens from the faucet (subject to cooldown) | `claimer` (signer), `faucet`, `vault`, `claim_record` (PDA), `claimer_token_account` |

## Account Structures

### Faucet

| Field | Type | Description |
|---|---|---|
| `authority` | `Pubkey` | Faucet admin who can fund the vault |
| `mint` | `Pubkey` | SPL token mint distributed by this faucet |
| `amount_per_claim` | `u64` | Tokens dispensed per claim |
| `cooldown_seconds` | `i64` | Minimum seconds between claims per wallet |
| `total_distributed` | `u64` | Cumulative tokens distributed |
| `bump` | `u8` | PDA bump seed |

### ClaimRecord

| Field | Type | Description |
|---|---|---|
| `wallet` | `Pubkey` | Claimer's wallet address |
| `faucet` | `Pubkey` | Associated faucet |
| `last_claim_ts` | `i64` | Unix timestamp of last claim |
| `total_claimed` | `u64` | Cumulative tokens claimed by this wallet |
| `bump` | `u8` | PDA bump seed |

## PDA Seeds

- **Faucet:** `["faucet", mint]`
- **Vault:** `["vault", faucet]`
- **ClaimRecord:** `["claim", faucet, claimer]`

## Error Codes

| Error | Description |
|---|---|
| `CooldownNotElapsed` | Wallet must wait before claiming again |
| `InsufficientBalance` | Vault does not have enough tokens |
| `Overflow` | Arithmetic overflow |

## Build & Test

```bash
anchor build
anchor test
```

## Deploy

```bash
solana config set --url devnet
anchor deploy
```

## License

[MIT](LICENSE)

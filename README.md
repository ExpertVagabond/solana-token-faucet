# solana-token-faucet

On-chain token faucet with configurable rate limits and per-wallet cooldown periods. Built with Anchor on Solana.

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white)
![Anchor](https://img.shields.io/badge/Anchor-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- Per-wallet cooldown tracking
- Configurable distribution amount
- Admin-controlled token supply
- Rate limiting via on-chain timestamps

## Program Instructions

`initialize` | `request_tokens`

## Build

```bash
anchor build
```

## Test

```bash
anchor test
```

## Deploy

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

## Project Structure

```
programs/
  solana-token-faucet/
    src/
      lib.rs          # Program entry point and instructions
    Cargo.toml
tests/
  solana-token-faucet.ts           # Integration tests
Anchor.toml             # Anchor configuration
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Author

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io)

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaTokenFaucet } from "../target/types/solana_token_faucet";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

describe("solana-token-faucet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .solanaTokenFaucet as Program<SolanaTokenFaucet>;

  const authority = Keypair.generate();
  const claimer = Keypair.generate();

  let mint: PublicKey;
  let authorityTokenAccount: PublicKey;
  let claimerTokenAccount: PublicKey;
  let faucetPDA: PublicKey;
  let faucetBump: number;
  let vaultPDA: PublicKey;

  const DRIP_AMOUNT = 1_000_000; // 1 token (6 decimals)
  const COOLDOWN_SECONDS = 5;
  const FUND_AMOUNT = 100_000_000; // 100 tokens

  // Helpers
  const findFaucetPDA = (mintKey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("faucet"), mintKey.toBuffer()],
      program.programId
    );
  };

  const findVaultPDA = (faucetKey: PublicKey): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), faucetKey.toBuffer()],
      program.programId
    );
  };

  const findClaimRecordPDA = (
    faucetKey: PublicKey,
    claimerKey: PublicKey
  ): [PublicKey, number] => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim"),
        faucetKey.toBuffer(),
        claimerKey.toBuffer(),
      ],
      program.programId
    );
  };

  /** Sleep helper for cooldown tests. */
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  before(async () => {
    // Fund wallets
    const sig1 = await provider.connection.requestAirdrop(
      authority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    const sig2 = await provider.connection.requestAirdrop(
      claimer.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig1);
    await provider.connection.confirmTransaction(sig2);

    // Create SPL token mint
    mint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create authority's token account and mint tokens into it for funding
    authorityTokenAccount = await createAccount(
      provider.connection,
      authority,
      mint,
      authority.publicKey
    );

    await mintTo(
      provider.connection,
      authority,
      mint,
      authorityTokenAccount,
      authority,
      FUND_AMOUNT
    );

    // Create claimer's token account
    claimerTokenAccount = await createAccount(
      provider.connection,
      claimer,
      mint,
      claimer.publicKey
    );

    // Derive PDAs
    [faucetPDA, faucetBump] = findFaucetPDA(mint);
    [vaultPDA] = findVaultPDA(faucetPDA);
  });

  // ---------- initialize_faucet ----------

  describe("initialize_faucet", () => {
    it("creates a faucet with drip amount and cooldown", async () => {
      await program.methods
        .initializeFaucet(
          new anchor.BN(DRIP_AMOUNT),
          new anchor.BN(COOLDOWN_SECONDS)
        )
        .accounts({
          authority: authority.publicKey,
          mint: mint,
          faucet: faucetPDA,
          vault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([authority])
        .rpc();

      const faucet = await program.account.faucet.fetch(faucetPDA);
      expect(faucet.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );
      expect(faucet.mint.toBase58()).to.equal(mint.toBase58());
      expect(faucet.amountPerClaim.toNumber()).to.equal(DRIP_AMOUNT);
      expect(faucet.cooldownSeconds.toNumber()).to.equal(COOLDOWN_SECONDS);
      expect(faucet.totalDistributed.toNumber()).to.equal(0);

      // Vault should exist and be empty
      const vault = await getAccount(provider.connection, vaultPDA);
      expect(Number(vault.amount)).to.equal(0);
    });
  });

  // ---------- fund_faucet ----------

  describe("fund_faucet", () => {
    it("funds the faucet vault with tokens", async () => {
      await program.methods
        .fundFaucet(new anchor.BN(FUND_AMOUNT))
        .accounts({
          authority: authority.publicKey,
          faucet: faucetPDA,
          vault: vaultPDA,
          authorityTokenAccount: authorityTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([authority])
        .rpc();

      const vault = await getAccount(provider.connection, vaultPDA);
      expect(Number(vault.amount)).to.equal(FUND_AMOUNT);

      const authorityAcct = await getAccount(
        provider.connection,
        authorityTokenAccount
      );
      expect(Number(authorityAcct.amount)).to.equal(0);
    });
  });

  // ---------- claim_tokens ----------

  describe("claim_tokens", () => {
    it("claims tokens from the faucet on first claim", async () => {
      const [claimRecordPDA] = findClaimRecordPDA(
        faucetPDA,
        claimer.publicKey
      );

      await program.methods
        .claimTokens()
        .accounts({
          claimer: claimer.publicKey,
          faucet: faucetPDA,
          vault: vaultPDA,
          claimRecord: claimRecordPDA,
          claimerTokenAccount: claimerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      // Claimer should have received drip amount
      const claimerAcct = await getAccount(
        provider.connection,
        claimerTokenAccount
      );
      expect(Number(claimerAcct.amount)).to.equal(DRIP_AMOUNT);

      // Vault should be decremented
      const vault = await getAccount(provider.connection, vaultPDA);
      expect(Number(vault.amount)).to.equal(FUND_AMOUNT - DRIP_AMOUNT);

      // Claim record should be created
      const record = await program.account.claimRecord.fetch(claimRecordPDA);
      expect(record.wallet.toBase58()).to.equal(
        claimer.publicKey.toBase58()
      );
      expect(record.faucet.toBase58()).to.equal(faucetPDA.toBase58());
      expect(record.totalClaimed.toNumber()).to.equal(DRIP_AMOUNT);
      expect(record.lastClaimTs.toNumber()).to.be.greaterThan(0);

      // Faucet total_distributed should update
      const faucet = await program.account.faucet.fetch(faucetPDA);
      expect(faucet.totalDistributed.toNumber()).to.equal(DRIP_AMOUNT);
    });
  });

  // ---------- error: claim before cooldown expires ----------

  describe("claim before cooldown expires", () => {
    it("fails when claiming again before cooldown elapses", async () => {
      const [claimRecordPDA] = findClaimRecordPDA(
        faucetPDA,
        claimer.publicKey
      );

      try {
        await program.methods
          .claimTokens()
          .accounts({
            claimer: claimer.publicKey,
            faucet: faucetPDA,
            vault: vaultPDA,
            claimRecord: claimRecordPDA,
            claimerTokenAccount: claimerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown CooldownNotElapsed");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CooldownNotElapsed");
      }
    });

    it("succeeds after cooldown period has elapsed", async () => {
      // Wait for the cooldown to expire
      await sleep((COOLDOWN_SECONDS + 2) * 1000);

      const [claimRecordPDA] = findClaimRecordPDA(
        faucetPDA,
        claimer.publicKey
      );

      await program.methods
        .claimTokens()
        .accounts({
          claimer: claimer.publicKey,
          faucet: faucetPDA,
          vault: vaultPDA,
          claimRecord: claimRecordPDA,
          claimerTokenAccount: claimerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      // Claimer should have 2x drip amount now
      const claimerAcct = await getAccount(
        provider.connection,
        claimerTokenAccount
      );
      expect(Number(claimerAcct.amount)).to.equal(DRIP_AMOUNT * 2);

      // Claim record total should reflect both claims
      const record = await program.account.claimRecord.fetch(claimRecordPDA);
      expect(record.totalClaimed.toNumber()).to.equal(DRIP_AMOUNT * 2);

      // Faucet total_distributed should also reflect both
      const faucet = await program.account.faucet.fetch(faucetPDA);
      expect(faucet.totalDistributed.toNumber()).to.equal(DRIP_AMOUNT * 2);
    });
  });

  // ---------- different claimer works independently ----------

  describe("independent claimers", () => {
    it("a second claimer can claim independently", async () => {
      const claimer2 = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        claimer2.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const claimer2TokenAccount = await createAccount(
        provider.connection,
        claimer2,
        mint,
        claimer2.publicKey
      );

      const [claimRecordPDA] = findClaimRecordPDA(
        faucetPDA,
        claimer2.publicKey
      );

      await program.methods
        .claimTokens()
        .accounts({
          claimer: claimer2.publicKey,
          faucet: faucetPDA,
          vault: vaultPDA,
          claimRecord: claimRecordPDA,
          claimerTokenAccount: claimer2TokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer2])
        .rpc();

      const claimer2Acct = await getAccount(
        provider.connection,
        claimer2TokenAccount
      );
      expect(Number(claimer2Acct.amount)).to.equal(DRIP_AMOUNT);

      const faucet = await program.account.faucet.fetch(faucetPDA);
      expect(faucet.totalDistributed.toNumber()).to.equal(DRIP_AMOUNT * 3);
    });
  });
});

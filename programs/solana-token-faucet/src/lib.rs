use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("GsHPNhJtQ23Nj2duABZNDAdn1ri2kjxkeTXqH6SUSN1v");

#[program]
pub mod solana_token_faucet {
    use super::*;

    pub fn initialize_faucet(ctx: Context<InitializeFaucet>, amount_per_claim: u64, cooldown_seconds: i64) -> Result<()> {
        let f = &mut ctx.accounts.faucet;
        f.authority = ctx.accounts.authority.key();
        f.mint = ctx.accounts.mint.key();
        f.amount_per_claim = amount_per_claim;
        f.cooldown_seconds = cooldown_seconds;
        f.total_distributed = 0;
        f.bump = ctx.bumps.faucet;
        Ok(())
    }

    pub fn fund_faucet(ctx: Context<FundFaucet>, amount: u64) -> Result<()> {
        token::transfer(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.authority_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ), amount)?;
        Ok(())
    }

    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        let faucet = &ctx.accounts.faucet;
        let record = &mut ctx.accounts.claim_record;
        let clock = Clock::get()?;

        if record.last_claim_ts != 0 {
            let elapsed = clock.unix_timestamp.checked_sub(record.last_claim_ts).ok_or(FaucetError::Overflow)?;
            require!(elapsed >= faucet.cooldown_seconds, FaucetError::CooldownNotElapsed);
        }

        require!(ctx.accounts.vault.amount >= faucet.amount_per_claim, FaucetError::InsufficientBalance);

        let mint_key = faucet.mint;
        let seeds: &[&[u8]] = &[b"faucet", mint_key.as_ref(), &[faucet.bump]];

        token::transfer(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.claimer_token_account.to_account_info(),
                authority: ctx.accounts.faucet.to_account_info(),
            },
            &[seeds],
        ), faucet.amount_per_claim)?;

        record.wallet = ctx.accounts.claimer.key();
        record.faucet = ctx.accounts.faucet.key();
        record.last_claim_ts = clock.unix_timestamp;
        record.total_claimed = record.total_claimed.checked_add(faucet.amount_per_claim).ok_or(FaucetError::Overflow)?;

        let faucet = &mut ctx.accounts.faucet;
        faucet.total_distributed = faucet.total_distributed.checked_add(faucet.amount_per_claim).ok_or(FaucetError::Overflow)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeFaucet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(init, payer = authority, space = 8 + Faucet::INIT_SPACE, seeds = [b"faucet", mint.key().as_ref()], bump)]
    pub faucet: Account<'info, Faucet>,
    #[account(init, payer = authority, token::mint = mint, token::authority = faucet, seeds = [b"vault", faucet.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FundFaucet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"faucet", faucet.mint.as_ref()], bump = faucet.bump, has_one = authority)]
    pub faucet: Account<'info, Faucet>,
    #[account(mut, seeds = [b"vault", faucet.key().as_ref()], bump, token::mint = faucet.mint, token::authority = faucet)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = faucet.mint, token::authority = authority)]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(mut, seeds = [b"faucet", faucet.mint.as_ref()], bump = faucet.bump)]
    pub faucet: Account<'info, Faucet>,
    #[account(mut, seeds = [b"vault", faucet.key().as_ref()], bump, token::mint = faucet.mint, token::authority = faucet)]
    pub vault: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = claimer, space = 8 + ClaimRecord::INIT_SPACE,
        seeds = [b"claim", faucet.key().as_ref(), claimer.key().as_ref()], bump)]
    pub claim_record: Account<'info, ClaimRecord>,
    #[account(mut, token::mint = faucet.mint, token::authority = claimer)]
    pub claimer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Faucet {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub amount_per_claim: u64,
    pub cooldown_seconds: i64,
    pub total_distributed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub wallet: Pubkey,
    pub faucet: Pubkey,
    pub last_claim_ts: i64,
    pub total_claimed: u64,
    pub bump: u8,
}

#[error_code]
pub enum FaucetError {
    #[msg("Cooldown not elapsed")]
    CooldownNotElapsed,
    #[msg("Insufficient vault balance")]
    InsufficientBalance,
    #[msg("Overflow")]
    Overflow,
}

import { NextResponse } from 'next/server';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { recordSweepLog } from '@/lib/db';
import { sendSweepNotification } from '@/lib/telegram';

const KEEP_SOL = Number(process.env.SWEEP_KEEP_SOL ?? '0.2');
const KEEP_USDC = Number(process.env.SWEEP_KEEP_USDC ?? '20');
const MIN_SOL_SWEEP = Number(process.env.SWEEP_MIN_SOL ?? '0.01');
const MIN_USDC_SWEEP = Number(process.env.SWEEP_MIN_USDC ?? '1');
const FEE_BUFFER_LAMPORTS = 5_000; // ~0.000005 SOL

const USDC_DECIMALS = 6;
const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function loadTraderKeypair(): Keypair | null {
  const secret = process.env.TRADER_PRIVATE_KEY;
  if (!secret) return null;

  try {
    const bytes = JSON.parse(secret);
    if (Array.isArray(bytes)) {
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    }
  } catch {
    // Not JSON
  }

  try {
    const decoded = bs58.decode(secret);
    return Keypair.fromSecretKey(decoded);
  } catch (err) {
    console.error('Failed to parse TRADER_PRIVATE_KEY:', err);
    return null;
  }
}

function createConnection(): Connection {
  const endpoint = process.env.SOLANA_RPC_URL;
  if (!endpoint) {
    throw new Error('Missing SOLANA_RPC_URL environment variable.');
  }
  return new Connection(endpoint, 'confirmed');
}

async function ensureProjectAta(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey
) {
  const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID
    );
    return { ata, instruction: ix };
  }
  return { ata, instruction: null };
}

async function sweepSol(
  connection: Connection,
  trader: Keypair,
  destination: PublicKey
) {
  const balance = await connection.getBalance(trader.publicKey);
  const keepLamports = Math.floor(KEEP_SOL * LAMPORTS_PER_SOL);
  const minLamports = Math.floor(MIN_SOL_SWEEP * LAMPORTS_PER_SOL);
  const available = balance - keepLamports;

  if (available <= minLamports + FEE_BUFFER_LAMPORTS) {
    return null;
  }

  const lamportsToSend = available - FEE_BUFFER_LAMPORTS;
  if (lamportsToSend <= 0) return null;

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: trader.publicKey,
      toPubkey: destination,
      lamports: lamportsToSend,
    })
  );

  const signature = await connection.sendTransaction(tx, [trader], {
    skipPreflight: true,
  });
  await connection.confirmTransaction(signature, 'confirmed');

  return {
    lamports: lamportsToSend,
    signature,
  };
}

async function sweepUsdc(
  connection: Connection,
  trader: Keypair,
  projectWallet: PublicKey,
  mint: PublicKey
) {
  const traderAta = await getAssociatedTokenAddress(mint, trader.publicKey, false, TOKEN_PROGRAM_ID);
  const balanceInfo = await connection.getTokenAccountBalance(traderAta).catch(() => null);
  if (!balanceInfo) return null;

  const currentMinor = BigInt(balanceInfo.value.amount);
  const keepMinor = BigInt(Math.floor(KEEP_USDC * 10 ** USDC_DECIMALS));
  const minMinor = BigInt(Math.floor(MIN_USDC_SWEEP * 10 ** USDC_DECIMALS));

  if (currentMinor <= keepMinor + minMinor) {
    return null;
  }

  const amountMinor = currentMinor - keepMinor;
  if (amountMinor <= minMinor) return null;

  const instructions = [];
  const { ata: projectAta, instruction } = await ensureProjectAta(connection, trader, projectWallet, mint);
  if (instruction) {
    instructions.push(instruction);
  }

  instructions.push(
    createTransferCheckedInstruction(
      traderAta,
      mint,
      projectAta,
      trader.publicKey,
      amountMinor,
      USDC_DECIMALS,
      undefined,
      TOKEN_PROGRAM_ID
    )
  );

  const tx = new Transaction().add(...instructions);
  const signature = await connection.sendTransaction(tx, [trader], {
    skipPreflight: true,
  });
  await connection.confirmTransaction(signature, 'confirmed');

  return {
    amountMinor,
    signature,
  };
}

export async function GET() {
  const projectWalletAddress = process.env.NEXT_PUBLIC_PROJECT_WALLET;
  if (!projectWalletAddress) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_PROJECT_WALLET missing' }, { status: 500 });
  }

  if (!process.env.TRADER_PRIVATE_KEY) {
    return NextResponse.json({ error: 'TRADER_PRIVATE_KEY not configured' }, { status: 503 });
  }

  let connection: Connection;
  let trader: Keypair | null = null;
  try {
    connection = createConnection();
    trader = loadTraderKeypair();
  } catch (err: any) {
    console.error('Sweep setup failed:', err);
    return NextResponse.json({ error: 'Sweep misconfigured' }, { status: 500 });
  }

  if (!trader) {
    return NextResponse.json({ error: 'TRADER_PRIVATE_KEY invalid' }, { status: 503 });
  }

  let usdcMint: PublicKey;
  try {
    usdcMint = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? DEFAULT_USDC_MINT);
  } catch {
    return NextResponse.json({ error: 'Invalid NEXT_PUBLIC_USDC_MINT' }, { status: 500 });
  }

  const projectWallet = new PublicKey(projectWalletAddress);

  const [solResult, usdcResult] = await Promise.all([
    sweepSol(connection, trader, projectWallet),
    sweepUsdc(connection, trader, projectWallet, usdcMint),
  ]);

  if (!solResult && !usdcResult) {
    return NextResponse.json({ swept: false, message: 'Nothing to sweep' });
  }

  const solSwept = solResult ? solResult.lamports / LAMPORTS_PER_SOL : 0;
  const usdcSwept = usdcResult ? Number(usdcResult.amountMinor) / 10 ** USDC_DECIMALS : 0;

  await recordSweepLog({
    solSwept: solSwept.toFixed(9),
    usdcSwept: usdcSwept.toFixed(6),
    solSignature: solResult?.signature,
    usdcSignature: usdcResult?.signature,
  });

  await sendSweepNotification({
    sol: solSwept,
    usdc: usdcSwept,
    solSignature: solResult?.signature,
    usdcSignature: usdcResult?.signature,
  });

  return NextResponse.json({
    swept: true,
    sol: solSwept,
    usdc: usdcSwept,
    solSignature: solResult?.signature,
    usdcSignature: usdcResult?.signature,
  });
}

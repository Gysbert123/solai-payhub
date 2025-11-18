import { NextRequest, NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  confirmMarketplacePurchase,
  getMarketplaceListingById,
  reserveMarketplaceListingForBuyer,
} from '@/lib/db';
import BigNumber from 'bignumber.js';

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const USDC_MINT_ADDRESS = process.env.NEXT_PUBLIC_USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_PRIVATE_KEY; // Base58 encoded private key for agent payments

const USDC_MINT = new PublicKey(USDC_MINT_ADDRESS);
const USDC_DECIMALS = 6;
const PURCHASE_PRICE = new BigNumber(0.005);

async function getTokenProgramId(connection: Connection, mint: PublicKey) {
  try {
    const mintInfo = await connection.getAccountInfo(mint);
    if (!mintInfo) return TOKEN_2022_PROGRAM_ID;
    return mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  } catch {
    return TOKEN_2022_PROGRAM_ID;
  }
}

function loadAgentKeypair(): Keypair | null {
  if (!AGENT_WALLET_KEY) {
    console.warn('AGENT_WALLET_PRIVATE_KEY not configured');
    return null;
  }
  try {
    // Try base58 first
    const secretKey = bs58.decode(AGENT_WALLET_KEY);
    return Keypair.fromSecretKey(secretKey);
  } catch {
    try {
      // Try JSON array
      const parsed = JSON.parse(AGENT_WALLET_KEY);
      if (Array.isArray(parsed)) {
        return Keypair.fromSecretKey(Uint8Array.from(parsed));
      }
    } catch {
      console.error('Failed to parse AGENT_WALLET_PRIVATE_KEY');
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json({ error: 'Project wallet misconfigured' }, { status: 500 });
  }

  const agentKeypair = loadAgentKeypair();
  if (!agentKeypair) {
    return NextResponse.json({ error: 'Agent wallet not configured' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : null;
  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : 'agent';

  if (!listingId) {
    return NextResponse.json({ error: 'listingId required' }, { status: 400 });
  }

  const listing = await getMarketplaceListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  if (listing.status !== 'active') {
    return NextResponse.json(
      { error: 'Listing not available', status: listing.status },
      { status: 409 }
    );
  }

  const connection = new Connection(SOLANA_ENDPOINT, 'confirmed');
  const projectWalletKey = new PublicKey(PROJECT_WALLET);
  const agentWalletKey = agentKeypair.publicKey;

  try {
    // Reserve the listing
    const purchaseReference = Keypair.generate().publicKey.toBase58();
    await reserveMarketplaceListingForBuyer({
      listingId: listing.id,
      buyerAgentId: agentId,
      buyerWallet: agentWalletKey.toBase58(),
      purchaseReference,
    });

    // Get token program ID
    const tokenProgramId = await getTokenProgramId(connection, USDC_MINT);

    // Ensure agent has USDC token account
    const agentAta = await getAssociatedTokenAddress(USDC_MINT, agentWalletKey, undefined, tokenProgramId);
    const agentAtaInfo = await connection.getAccountInfo(agentAta);
    const agentAtaInstructions = [];
    if (!agentAtaInfo) {
      agentAtaInstructions.push(
        createAssociatedTokenAccountInstruction(
          agentWalletKey,
          agentAta,
          agentWalletKey,
          USDC_MINT,
          tokenProgramId
        )
      );
    }

    // Ensure project wallet has USDC token account
    const projectAta = await getAssociatedTokenAddress(USDC_MINT, projectWalletKey, undefined, tokenProgramId);
    const projectAtaInfo = await connection.getAccountInfo(projectAta);
    const projectAtaInstructions = [];
    if (!projectAtaInfo) {
      projectAtaInstructions.push(
        createAssociatedTokenAccountInstruction(
          agentWalletKey, // Agent pays for creation
          projectAta,
          projectWalletKey,
          USDC_MINT,
          tokenProgramId
        )
      );
    }

    // Create transfer instruction
    const amountMinor = PURCHASE_PRICE.multipliedBy(new BigNumber(10).pow(USDC_DECIMALS)).integerValue();
    const referenceKey = new PublicKey(purchaseReference);
    const transferIx = createTransferCheckedInstruction(
      agentAta,
      USDC_MINT,
      projectAta,
      agentWalletKey,
      BigInt(amountMinor.toString()),
      USDC_DECIMALS,
      undefined,
      tokenProgramId
    );
    transferIx.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

    // Build and send transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    const transaction = new Transaction({
      feePayer: agentWalletKey,
      blockhash,
      lastValidBlockHeight,
    });
    transaction.add(...agentAtaInstructions, ...projectAtaInstructions, transferIx);
    transaction.sign(agentKeypair);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Confirm purchase and get content
    const DEFAULT_RAKE_BPS = 2000;
    const rakeBps = listing.rake_bps ?? DEFAULT_RAKE_BPS;
    const gross = PURCHASE_PRICE;
    const rake = gross.multipliedBy(rakeBps).dividedBy(10_000);
    const seller = gross.minus(rake);

    const updated = await confirmMarketplacePurchase({
      listingId: listing.id,
      signature,
      rakeAmount: rake.toFixed(6),
      sellerAmount: seller.toFixed(6),
      keepActive: true, // Keep listing active for multiple purchases
      buyerAgentId: agentId,
      buyerWallet: agentWalletKey.toBase58(),
      purchaseReference: purchaseReference,
    });

    return NextResponse.json({
      status: 'delivered',
      content: updated?.content,
      listing: updated,
      signature,
    });
  } catch (error: any) {
    console.error('Agent purchase failed:', error);
    return NextResponse.json(
      { error: error?.message || 'Purchase failed' },
      { status: 500 }
    );
  }
}


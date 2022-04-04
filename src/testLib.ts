import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createAuctionHouse, buy, sell, executeSale } from "../src/lib";
import { AuctionHouseProgram } from "@metaplex-foundation/mpl-auction-house";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CreateMetadataV2,
  Creator,
  DataV2,
  Metadata,
} from "@metaplex-foundation/mpl-token-metadata";

interface Ctx {
  connection: Connection;
  payer: Keypair;
  owner: Keypair;
  seller: Keypair;
  buyer: Keypair;
  tokenMint: PublicKey;
  treasuryMint: PublicKey;
}

export function simple(args: () => Promise<Ctx>) {
  let ctx: Ctx;
  let auctionHouse: PublicKey;

  beforeAll(async () => {
    ctx = await args();

    await sendAndConfirmTransaction(
      ctx.connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ctx.payer.publicKey,
          toPubkey: ctx.buyer.publicKey,
          lamports: LAMPORTS_PER_SOL * 0.1,
        })
      ),
      [ctx.payer]
    );

    await sendAndConfirmTransaction(
      ctx.connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ctx.payer.publicKey,
          toPubkey: ctx.seller.publicKey,
          lamports: LAMPORTS_PER_SOL * 0.1,
        })
      ),
      [ctx.payer]
    );

    await sendAndConfirmTransaction(
      ctx.connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: ctx.payer.publicKey,
          toPubkey: ctx.owner.publicKey,
          lamports: LAMPORTS_PER_SOL * 0.1,
        })
      ),
      [ctx.payer]
    );
  });

  test("create", async () => {
    auctionHouse = await createAuctionHouse(ctx.connection, {
      ...ctx,
      sellerFeeBasisPoints: 5000,
      canChangeSalePrice: false,
      requiresSignOff: false,
    });

    let auctionHouseInfo =
      await AuctionHouseProgram.accounts.AuctionHouse.fromAccountAddress(
        ctx.connection,
        auctionHouse
      );

    expect(auctionHouseInfo.creator.equals(ctx.owner.publicKey)).toBeTruthy();
  });

  test("sell", async () => {
    await sell(ctx.connection, {
      ...ctx,
      auctionHouse,
      buyerPrice: 3,
    });
  });

  test("buy", async () => {
    await buy(ctx.connection, {
      ...ctx,
      auctionHouse,
      buyerPrice: 3,
    });
  });

  test("execute sale", async () => {
    await executeSale(ctx.connection, {
      ...ctx,
      auctionHouse,
      buyer: ctx.buyer.publicKey,
      seller: ctx.seller.publicKey,
      buyerPrice: 3,
    });
  });
}

export async function tokenSetup(
  connection: Connection,
  { payer, seller }: { payer: Keypair; seller: Keypair }
) {
  //create token
  const mintedToken = await Token.createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    0,
    TOKEN_PROGRAM_ID
  );

  //create token accounts
  const sellerTokenAccount = await mintedToken.createAssociatedTokenAccount(
    seller.publicKey
  );

  //mint token to seller
  await mintedToken.mintTo(sellerTokenAccount, payer.publicKey, [payer], 1);

  //create token's metaplex metadata
  const creators = [
    new Creator({
      address: payer.publicKey.toString(),
      verified: false,
      share: 100,
    }),
  ];
  const metaDataPda = await Metadata.getPDA(mintedToken.publicKey);
  const initMetadataData = new DataV2({
    uri: "OwO",
    name: "UwU",
    symbol: ":3",
    sellerFeeBasisPoints: 10,
    creators,
    collection: null,
    uses: null,
  });
  await createMetaDataV2(
    connection,
    payer,
    payer,
    mintedToken.publicKey,
    metaDataPda,
    initMetadataData
  );

  return mintedToken;
}

export async function createMetaDataV2(
  connection: Connection,
  payer: Keypair,
  mintAuthority: Keypair,
  mint: PublicKey,
  metadata: PublicKey,
  metadataData: DataV2
) {
  const createMetadataTx = new CreateMetadataV2(
    { feePayer: payer.publicKey },
    {
      metadata,
      metadataData,
      mint,
      updateAuthority: mintAuthority.publicKey,
      mintAuthority: mintAuthority.publicKey,
    }
  );

  const transaction = await connection.sendTransaction(
    createMetadataTx,
    [payer, mintAuthority],
    {
      skipPreflight: false,
    }
  );

  await connection.confirmTransaction(transaction, "confirmed");
}

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

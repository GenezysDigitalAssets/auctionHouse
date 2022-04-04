import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { AuctionHouseProgram } from "@metaplex-foundation/mpl-auction-house";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

interface CreateAuctionHouse {
  owner: Keypair;
  payer: Keypair;
  //if you wish to empty the treasury account, this is where it will land. Pass in a wallet, not an ATA - ATA will be made for you if not present.
  treasuryWithdrawalDestinationOwner?: PublicKey;
  //if you wish to empty the fee paying account, this is where it will land
  feeWithdrawalDestination?: PublicKey;
  //Mint address of treasury
  treasuryMint: PublicKey;
  //Auction house cut of each txn, 10000 = 100%
  sellerFeeBasisPoints: number;
  //if true, and user initially places item for sale for 0, then AH can make new sell prices without consent(off chain price matching). Should only be used in concert with requires-sign-off, so AH is controlling every txn hitting the system.
  canChangeSalePrice?: boolean;
  //if true, no txn can occur against this Auction House without AH authority as signer. Good if you are doing all txns through a pass-through GCP or something.
  requiresSignOff?: boolean;
}

export async function createAuctionHouse(
  connection: Connection,
  {
    owner,
    payer,
    treasuryWithdrawalDestinationOwner = owner.publicKey,
    feeWithdrawalDestination = owner.publicKey,
    treasuryMint = WRAPPED_SOL_MINT,
    sellerFeeBasisPoints,
    canChangeSalePrice = false,
    requiresSignOff = false,
  }: CreateAuctionHouse
) {
  const isNative = treasuryMint.equals(WRAPPED_SOL_MINT);

  const treasuryWithdrawalDestination = isNative
    ? treasuryWithdrawalDestinationOwner
    : (
        await AuctionHouseProgram.findAssociatedTokenAccountAddress(
          treasuryMint,
          treasuryWithdrawalDestinationOwner
        )
      )[0];

  const [auctionHouse, bump] =
    await AuctionHouseProgram.findAuctionHouseAddress(
      owner.publicKey,
      treasuryMint
    );

  const [auctionHouseFeeAccount, feePayerBump] =
    await AuctionHouseProgram.findAuctionHouseFeeAddress(auctionHouse);

  const [auctionHouseTreasury, treasuryBump] =
    await AuctionHouseProgram.findAuctionHouseTreasuryAddress(auctionHouse);

  const t = new Transaction().add(
    AuctionHouseProgram.instructions.createCreateAuctionHouseInstruction(
      {
        payer: payer.publicKey,
        authority: owner.publicKey,
        treasuryWithdrawalDestinationOwner,
        treasuryWithdrawalDestination,
        feeWithdrawalDestination,
        treasuryMint,
        auctionHouse,
        auctionHouseFeeAccount,
        auctionHouseTreasury,
      },
      {
        bump,
        feePayerBump,
        treasuryBump,
        sellerFeeBasisPoints,
        requiresSignOff,
        canChangeSalePrice,
      }
    )
  );

  await sendAndConfirmTransaction(connection, t, [payer]);
  return auctionHouse;
}

interface Sell {
  seller: Keypair;
  auctionHouse: PublicKey;
  // If this auction house requires sign off, pass in keypair for it
  auctionHouseKeypair?: Keypair;
  //Mint of the token to sell
  tokenMint: PublicKey;
  //Price you wish to sell for
  buyerPrice: number;
  //Amount of tokens you want to sell
  tokenSize?: number;
}

export async function sell(
  connection: Connection,
  {
    seller,
    auctionHouse,
    auctionHouseKeypair,
    tokenMint,
    buyerPrice,
    tokenSize = 1,
  }: Sell
) {
  const metadata = await Metadata.getPDA(tokenMint);

  const auctionHouseInfo =
    await AuctionHouseProgram.accounts.AuctionHouse.fromAccountAddress(
      connection,
      auctionHouse
    );

  const tokenAccount = (await connection.getTokenLargestAccounts(tokenMint))
    .value[0].address;
  const [programAsSigner, programAsSignerBump] =
    await AuctionHouseProgram.findAuctionHouseProgramAsSignerAddress();

  const [sellerTradeState, tradeStateBump] =
    await AuctionHouseProgram.findTradeStateAddress(
      seller.publicKey,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      buyerPrice,
      tokenSize
    );

  const [freeSellerTradeState, freeTradeStateBump] =
    await AuctionHouseProgram.findTradeStateAddress(
      seller.publicKey,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      0,
      tokenSize
    );

  const t = AuctionHouseProgram.instructions.createSellInstruction(
    {
      wallet: seller.publicKey,
      authority: auctionHouseInfo.authority,
      auctionHouseFeeAccount: auctionHouseInfo.auctionHouseFeeAccount,
      tokenAccount,
      metadata,
      auctionHouse,
      sellerTradeState,
      freeSellerTradeState,
      programAsSigner,
    },
    {
      tradeStateBump,
      freeTradeStateBump,
      programAsSignerBump,
      buyerPrice,
      tokenSize,
    }
  );

  const signers: Keypair[] = [seller];

  if (auctionHouseKeypair) {
    signers.push(auctionHouseKeypair);
  }

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(t),
    signers
  );
}

interface Buy {
  buyer: Keypair;
  auctionHouse: PublicKey;
  //If this auction house requires sign off, pass in keypair for it
  auctionHouseKeypair?: Keypair;
  //Token account of the token to purchase - defaults to finding the one with highest balance (for NFTs)
  // tokenAccount?: PublicKey;
  //Mint of the token to purchase
  tokenMint: PublicKey;
  //Price you wish to buy for
  buyerPrice: number;
  //Amount of tokens you want to buy
  tokenSize?: number;
}
export async function buy(
  connection: Connection,
  {
    buyer,
    auctionHouse,
    auctionHouseKeypair,
    // tokenAccount,
    tokenMint,
    buyerPrice,
    tokenSize = 1,
  }: Buy
) {
  const auctionHouseInfo =
    await AuctionHouseProgram.accounts.AuctionHouse.fromAccountAddress(
      connection,
      auctionHouse
    );
  const isNative = auctionHouseInfo.treasuryMint.equals(WRAPPED_SOL_MINT);
  const metadata = await Metadata.getPDA(tokenMint);

  const tokenAccount = (await connection.getTokenLargestAccounts(tokenMint))
    .value[0].address;

  const [escrowPaymentAccount, escrowPaymentBump] =
    await AuctionHouseProgram.findEscrowPaymentAccountAddress(
      auctionHouse,
      buyer.publicKey
    );

  const [buyerTradeState, tradeStateBump] =
    await AuctionHouseProgram.findTradeStateAddress(
      buyer.publicKey,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      buyerPrice,
      tokenSize
    );

  async function setup(
    transferAuthority: PublicKey,
    paymentAccount: PublicKey
  ) {
    const buy = AuctionHouseProgram.instructions.createBuyInstruction(
      {
        wallet: buyer.publicKey,
        paymentAccount,
        transferAuthority,
        tokenAccount,
        metadata,
        escrowPaymentAccount,
        auctionHouse,
        buyerTradeState,
        treasuryMint: auctionHouseInfo.treasuryMint,
        authority: auctionHouseInfo.authority,
        auctionHouseFeeAccount: auctionHouseInfo.auctionHouseFeeAccount,
      },
      {
        tradeStateBump,
        escrowPaymentBump,
        buyerPrice,
        tokenSize,
      }
    );

    // if (auctionHouseKeypair) {
    //   signers.push(auctionHouseKeypair);
    //   buy.keys[
    //     buy.keys.findIndex((k) =>
    //       k.pubkey.equals(auctionHouseKeypair.publicKey)
    //     )
    //   ].isSigner = true;
    // }

    return buy;
  }

  if (isNative) {
    const transferAuthority = buyer.publicKey;
    const paymentAccount = buyer.publicKey;
    const instruction = await setup(transferAuthority, paymentAccount);
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [buyer]
    );
  } else {
    const transferAuthority = Keypair.generate();
    const paymentAccount = (
      await AuctionHouseProgram.findAssociatedTokenAccountAddress(
        auctionHouseInfo.treasuryMint,
        buyer.publicKey
      )
    )[0];
    const transaction = new Transaction();

    const instruction = await setup(
      transferAuthority.publicKey,
      paymentAccount
    );
    instruction.keys[
      instruction.keys.findIndex((k) =>
        k.pubkey.equals(transferAuthority.publicKey)
      )
    ].isSigner = true;
    transaction.add(instruction);

    transaction.add(
      Token.createRevokeInstruction(
        TOKEN_PROGRAM_ID,
        paymentAccount,
        buyer.publicKey,
        []
      )
    );

    transaction.add(
      Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        paymentAccount,
        transferAuthority.publicKey,
        buyer.publicKey,
        [],
        buyerPrice
      )
    );

    await sendAndConfirmTransaction(connection, transaction, [
      buyer,
      transferAuthority,
    ]);
  }
}

interface ExecuteSale {
  payer: Keypair;
  auctionHouse: PublicKey;
  buyer: PublicKey;
  seller: PublicKey;
  //Token account of the token to purchase - defaults to finding the one with highest balance (for NFTs)
  // tokenAccount?: PublicKey;
  //If you want to simulate the auction house executing the sale without another signer
  auctionHouseSigns?: boolean;
  //Mint of the token being sold
  tokenMint: PublicKey;
  //Buyer price offer to execute the sale on
  buyerPrice: number;
  //Buyer ammount offer to execute the sale on
  tokenSize?: number;
}
export async function executeSale(
  connection: Connection,
  {
    payer,
    auctionHouse,
    buyer,
    seller,
    // tokenAccount,
    auctionHouseSigns = false,
    tokenMint,
    buyerPrice,
    tokenSize = 1,
  }: ExecuteSale
) {
  const metadata = await Metadata.getPDA(tokenMint);

  const tokenAccount = (
    await AuctionHouseProgram.findAssociatedTokenAccountAddress(
      tokenMint,
      seller
    )
  )[0];

  const auctionHouseInfo =
    await AuctionHouseProgram.accounts.AuctionHouse.fromAccountAddress(
      connection,
      auctionHouse
    );

  const [escrowPaymentAccount, escrowPaymentBump] =
    await AuctionHouseProgram.findEscrowPaymentAccountAddress(
      auctionHouse,
      buyer
    );

  const [programAsSigner, programAsSignerBump] =
    await AuctionHouseProgram.findAuctionHouseProgramAsSignerAddress();

  const [freeTradeState, freeTradeStateBump] =
    await AuctionHouseProgram.findTradeStateAddress(
      seller,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      0,
      tokenSize
    );

  const sellerTradeState = (
    await AuctionHouseProgram.findTradeStateAddress(
      seller,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      buyerPrice,
      tokenSize
    )
  )[0];

  const buyerTradeState = (
    await AuctionHouseProgram.findTradeStateAddress(
      buyer,
      auctionHouse,
      tokenAccount,
      auctionHouseInfo.treasuryMint,
      tokenMint,
      buyerPrice,
      tokenSize
    )
  )[0];

  const buyerReceiptTokenAccount = (
    await AuctionHouseProgram.findAssociatedTokenAccountAddress(
      tokenMint,
      buyer
    )
  )[0];

  const sellerPaymentReceiptAccount = (
    await AuctionHouseProgram.findAssociatedTokenAccountAddress(
      auctionHouseInfo.treasuryMint,
      seller
    )
  )[0];

  const t = await AuctionHouseProgram.instructions.createExecuteSaleInstruction(
    {
      buyer,
      seller,
      tokenAccount,
      tokenMint,
      metadata,
      escrowPaymentAccount,
      sellerPaymentReceiptAccount: seller,
      buyerReceiptTokenAccount,
      auctionHouse,
      buyerTradeState,
      sellerTradeState,
      freeTradeState,
      programAsSigner,
      auctionHouseFeeAccount: auctionHouseInfo.auctionHouseFeeAccount,
      auctionHouseTreasury: auctionHouseInfo.auctionHouseTreasury,
      treasuryMint: auctionHouseInfo.treasuryMint,
      authority: auctionHouseInfo.authority,
    },
    {
      escrowPaymentBump,
      freeTradeStateBump,
      programAsSignerBump,
      buyerPrice,
      tokenSize,
    }
  );

  const creators =
    (await Metadata.findByMint(connection, tokenMint)).data.data.creators || [];

  t.keys.push(
    ...creators.map((e) => ({
      pubkey: new PublicKey(e.address),
      isWritable: true,
      isSigner: false,
    }))
  );

  await sendAndConfirmTransaction(
    connection,
    new Transaction({ feePayer: payer.publicKey }).add(t),
    [payer]
  );
}

export const WRAPPED_SOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);

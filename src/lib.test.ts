import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import { WRAPPED_SOL_MINT } from "../src/lib";
import { simple, tokenSetup } from "../src/testLib";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("auction house", () => {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const payer = Keypair.generate();

  beforeAll(async () => {
    await connection
      .requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL * 2)
      .then((e) => connection.confirmTransaction(e));
  }, 50000);

  describe("custom currency", () => {
    async function setup() {
      const accounts = {
        payer,
        owner: Keypair.generate(),
        seller: Keypair.generate(),
        buyer: Keypair.generate(),
      };
      const nft = await tokenSetup(connection, accounts);
      const treasury = await Token.createMint(
        connection,
        payer,
        accounts.owner.publicKey,
        null,
        0,
        TOKEN_PROGRAM_ID
      );

      return {
        ...accounts,
        treasuryMint: treasury.publicKey,
        tokenMint: nft.publicKey,
        connection,
      };
    }

    simple(setup);
  });

  describe("native currency", () => {
    async function setup() {
      const accounts = {
        payer,
        owner: Keypair.generate(),
        seller: Keypair.generate(),
        buyer: Keypair.generate(),
      };
      const nft = await tokenSetup(connection, accounts);

      return {
        ...accounts,
        treasuryMint: WRAPPED_SOL_MINT,
        tokenMint: nft.publicKey,
        connection,
      };
    }

    simple(setup);
  });
});

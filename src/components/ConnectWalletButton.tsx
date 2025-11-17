"use client";

import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export const ConnectWalletButton = () => {
  return (
    <div className="flex justify-center mt-8">
      <WalletMultiButtonDynamic
        style={{
          background: "linear-gradient(to right, #a855f7, #ec4899)",
          borderRadius: "9999px",
          padding: "12px 32px",
          fontWeight: "bold",
          fontSize: "16px",
          boxShadow: "0 10px 20px rgba(168, 85, 247, 0.3)",
        }}
        className="hover:scale-105"
      />
    </div>
  );
};
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` genera AGENTS.md si detecta un agente de IA; la guía del
  // repositorio es el CLAUDE.md raíz.
  agentRules: false,
};

export default nextConfig;

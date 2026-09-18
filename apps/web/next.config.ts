import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['nodemailer', 'stripe', 'postgres'],
};

export default nextConfig;

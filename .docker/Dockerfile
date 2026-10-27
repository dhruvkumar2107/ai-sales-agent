FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.4

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the TypeScript project
RUN pnpm build

# Expose the port
EXPOSE 4000

# Set environment defaults
ENV NODE_ENV=development
ENV DATA_BACKEND=memory
ENV QUEUE_BACKEND=memory
ENV AUTH_MODE=dev
ENV LLM_PROVIDER=mock
ENV STT_PROVIDER=mock
ENV TTS_PROVIDER=mock
ENV TELEPHONY_PROVIDER=mock

# Start the API server
CMD ["pnpm", "dev"]
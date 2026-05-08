FROM node:22-bookworm-slim

# Fix pnpm build scripts issue
ENV COREPACK_ENABLE_STRICT=0

RUN apt-get update -qq && apt-get install -qqy --no-install-recommends git openssh-client curl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

# Create OpenClaw config
RUN mkdir -p /root/.openclaw
RUN echo '{"commands":{"native":"auto","nativeSkills":"auto","restart":true},"tools":{"profile":"full"},"gateway":{"mode":"local","port":49982,"controlUi":{"allowedOrigins":["null","https://wework-ai-production.up.railway.app"]},"auth":{"mode":"token","token":"openclaw1234"}},"plugins":{"entries":{}},"skills":{"entries":{}}}' > /root/.openclaw/openclaw.json

WORKDIR /data

EXPOSE 49982

CMD ["openclaw", "gateway"]

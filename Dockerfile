FROM node:22-bookworm-slim

# Fix pnpm build scripts issue
ENV COREPACK_ENABLE_STRICT=0
ENV DEEPSEEK_API_KEY=sk-3638d2ab8b2945dbb1aef49b677c71fd

RUN apt-get update -qq && apt-get install -qqy --no-install-recommends git openssh-client curl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

WORKDIR /data

EXPOSE 49982 80

CMD ["openclaw", "gateway"]

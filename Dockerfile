# rec-blog 构建器容器：只跑 Python，不装 pip 依赖（fontTools 已 vendored）
FROM python:3.11-slim

LABEL org.opencontainers.image.title="rec-blog builder"
LABEL org.opencontainers.image.description="静态站点构建器（Python 3.11，零第三方依赖）"

WORKDIR /src
COPY . .
RUN chmod +x deploy/entrypoint.sh

ENTRYPOINT ["/src/deploy/entrypoint.sh"]

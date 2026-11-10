#!/usr/bin/env bash
# 苹果CMS V10 (MacCMS10) 部署记录 —— 威联通 NAS
#
# 站点:   http://192.168.3.194:8088/
# 后台:   http://192.168.3.194:8088/cmsadmin.php
#         admin / Admin@2026
# 数据库: maccms10 (前缀 mac_),80 张表
#
# 关键坑(都踩过):
#  1. Docker daemon 存储在 CACHEDEV2,不是 CACHEDEV1!
#     Hermes 里看到的 /docker 是 cachedev1 —— 两者不是同一个卷。
#     挂载必须用宿主真实路径 /share/CACHEDEV1_DATA/docker/xxx
#     否则会落到一个 400M 已满的 tmpfs,报 "No space left on device"。
#  2. traefik / lucky / cloudflared 都是 host 网络,会抢占大量端口。
#     但真正让请求返回 Cloudflare 400 的是 Hermes 容器自己的
#     ALL_PROXY(v2rayA @ 20171) —— 它把内网请求也代理出去了。
#     在 Hermes 里测内网地址必须清掉所有代理变量:
#       env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
#           -u NO_PROXY -u no_proxy -u ALL_PROXY -u all_proxy curl ...
#     或设置 NO_PROXY=192.168.3.194。
#     端口用 8088(实测未被 traefik/lucky 占用)。
#  3. entrypoint.sh 会检测 index.php 是否存在,不存在就 git clone。
#     容器内访问 GitHub 不通会卡住并报 "No space left on device"(其实是 clone 失败)。
#     解法:宿主机先下好源码,拷进挂载目录。
#  4. application/database.php 需要 www-data 可写(默认 644 root 属主)。
#  5. runtime / upload / application 都要 777。

set -euo pipefail

MAC_VERSION="v2026.1000.4057"
MYSQL_ROOT_PASSWORD='Maccms@Nas2026'
WEB_ROOT="/share/CACHEDEV1_DATA/docker/maccms10/www"
PORT=8088

echo "==== 苹果CMS V10 部署 ===="
echo "版本: $MAC_VERSION"
echo "端口: $PORT"
echo "站点: http://192.168.3.194:$PORT/"
echo "后台: http://192.168.3.194:$PORT/cmsadmin.php  (admin / Admin@2026)"
echo

# ---------- 1. 镜像 ----------
echo "[1/6] 拉取镜像"
docker pull mirror.houlang.cloud/dh/library/mysql:5.7
docker pull mirror.houlang.cloud/dh/esme518/docker-maccms10:latest

# ---------- 2. 网络 ----------
echo "[2/6] 创建网络"
docker network create maccms-net 2>/dev/null || true

# ---------- 3. MySQL ----------
echo "[3/6] 启动 MySQL"
docker rm -f maccms-db >/dev/null 2>&1 || true
docker volume create maccms-mysql-data >/dev/null
docker run -d \
  --name maccms-db \
  --network maccms-net \
  --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  -e MYSQL_DATABASE=maccms10 \
  -e TZ=Asia/Shanghai \
  -v maccms-mysql-data:/var/lib/mysql \
  mirror.houlang.cloud/dh/library/mysql:5.7
sleep 30

# ---------- 4. 源码 ----------
echo "[4/6] 准备源码(宿主机下载,避免容器内 clone 失败)"
mkdir -p "$WEB_ROOT"
cd /tmp
if [ ! -f maccms10-master/index.php ]; then
  curl -sL -o /tmp/maccms10.zip \
    "https://github.com/magicblack/maccms10/archive/refs/heads/master.zip"
  python3 -c "import zipfile; zipfile.ZipFile('/tmp/maccms10.zip').extractall('/tmp')"
  cp -a /tmp/maccms10-master/. "$WEB_ROOT"/
  rm -rf "$WEB_ROOT"/.git "$WEB_ROOT"/.github "$WEB_ROOT"/tests "$WEB_ROOT"/docs
fi

# ---------- 5. 启动 Web ----------
echo "[5/6] 启动苹果CMS"
docker rm -f maccms >/dev/null 2>&1 || true
docker run -d \
  --name maccms \
  --network maccms-net \
  --restart unless-stopped \
  -p "${PORT}:80" \
  -e DB_HOST=maccms-db \
  -e DB_PORT=3306 \
  -e DB_NAME=maccms10 \
  -e DB_USER=root \
  -e DB_PASSWORD="$MYSQL_ROOT_PASSWORD" \
  -e ADMIN_PHP=cmsadmin.php \
  -e TZ=Asia/Shanghai \
  -v "$WEB_ROOT:/var/www/html" \
  mirror.houlang.cloud/dh/esme518/docker-maccms10:latest
sleep 15

# ---------- 6. 权限 ----------
echo "[6/6] 修权限"
docker exec maccms sh -c "
chmod 666 /var/www/html/application/database.php
chmod -R 777 /var/www/html/runtime /var/www/html/upload /var/www/html/application
"

cat << 'EOF'

==== 完成 ====
站点:   http://192.168.3.194:8088/
后台:   http://192.168.3.194:8088/cmsadmin.php
账号:   admin / Admin@2026

下一步:
1. 登录后台 → 采集 → 添加资源站(先导入 XML 采集 API)
2. TVBox 接入地址: http://192.168.3.194:8088/api.php/provide/vod/at/xml/
3. 要带过滤功能的 TVBox 接口,把 Tvbox.php 传到
   application/api/controller/ 目录,然后用 /api.php/tvbox
EOF
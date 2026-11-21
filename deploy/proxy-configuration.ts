import { siteOriginSchema } from "../src/server/origin";

/** Renders only calculator server blocks, without changing other virtual hosts.
 *
 * Args:
 *   origin: Validated canonical HTTPS origin for this installation.
 *   stage: HTTP challenge route or final HTTPS application proxy.
 *
 * Returns:
 *   An appendable Nginx fragment with a stable idempotence marker.
 */
export function renderProxyConfiguration(
  origin: string,
  stage: "http" | "tls",
): string {
  const url = new URL(siteOriginSchema.parse(origin));
  if (url.protocol !== "https:") throw new Error("Public proxy requires HTTPS");
  const serverName = JSON.stringify(url.hostname);
  if (stage === "http")
    return `# COFFEE_CALCULATOR_HTTP_BEGIN
server {
    listen 80;
    server_name ${serverName};
    location ^~ /.well-known/acme-challenge/ {
        root /etc/letsencrypt/coffee-market-calculator-webroot;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 308 https://$host$request_uri; }
}
# COFFEE_CALCULATOR_HTTP_END
`;
  return `# COFFEE_CALCULATOR_TLS_BEGIN
limit_req_zone $binary_remote_addr zone=coffee_calculator_auth:1m rate=6r/m;
server {
    listen 443 ssl;
    http2 on;
    server_name ${serverName};
    ssl_certificate /etc/letsencrypt/coffee-market-calculator/live/coffee-market-calculator/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/coffee-market-calculator/live/coffee-market-calculator/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 96k;
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $coffee_calculator_backend coffee-calculator-web:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_connect_timeout 5s;
    proxy_read_timeout 60s;
    proxy_buffering off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
    location /api/auth/ {
        client_max_body_size 8k;
        limit_req zone=coffee_calculator_auth burst=4 nodelay;
        limit_req_status 429;
        proxy_pass http://$coffee_calculator_backend;
    }
    location / { proxy_pass http://$coffee_calculator_backend; }
}
# COFFEE_CALCULATOR_TLS_END
`;
}

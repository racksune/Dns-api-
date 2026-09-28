# DNS Lookup API

Vercel par deploy karne ke liye keyless DNS lookup API. Cloudflare aur Google DNS-over-HTTPS dono se data lekar detailed combined response deti hai.

## Deploy

1. Is `vercel-dns-api` folder ko alag GitHub repository me upload karo ya Vercel me import karo.
2. Vercel me **Deploy** select karo.
3. Koi API key ya environment variable required nahi hai.

## Endpoint

Default request me important aur extra supported records sab milenge:

```text
GET /api/dns?name=google.com
```

Kisi ek record type ke liye:

```text
GET /api/dns?name=google.com&type=MX
GET /api/dns?name=google.com&type=TXT
```

## Included records

`A`, `AAAA`, `MX`, `NS`, `TXT`, `SOA`, `CAA`, `DNSKEY`, `SRV`, aur `CNAME`.

Response me merged answers ke saath Cloudflare aur Google ke complete provider responses, TTL, DNS status, DNSSEC status, authority records, additional records, response time, aur provider status bhi milta hai.
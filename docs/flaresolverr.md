# FlareSolverr

FlareSolverr is a proxy server that helps bypass Cloudflare and DDoS-GUARD protection for web scraping.

## Official Documentation

- [FlareSolverr GitHub](https://github.com/FlareSolverr/FlareSolverr)

## TRaSH Guides

- [Prowlarr - How to Set Up FlareSolverr](https://trash-guides.info/Prowlarr/prowlarr-setup-flaresolverr/) - Complete setup guide

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 8191 | TCP      | Proxy API   |

## Volumes

No persistent volumes required.

## Configuration

### Environment Variables

| Variable         | Default | Description             |
| ---------------- | ------- | ----------------------- |
| `LOG_LEVEL`      | `info`  | Logging verbosity       |
| `LOG_HTML`       | `false` | Log HTML responses      |
| `CAPTCHA_SOLVER` | `none`  | Captcha solving service |
| `TZ`             | -       | Timezone                |

### Prowlarr Integration

1. In Prowlarr, go to Settings → Indexers
2. Add Indexer Proxy:
   - Name: FlareSolverr
   - Tags: (optional, to apply to specific indexers)
   - Host: `http://flaresolverr:8191`

### How It Works

1. Prowlarr sends requests through FlareSolverr
2. FlareSolverr uses a headless browser to solve challenges
3. Returns the response to Prowlarr

## Integration with Other Services

- **Prowlarr**: Primary consumer for indexer access

## Notes

- FlareSolverr runs a headless Chrome browser
- CPU usage spikes during challenge solving
- Not needed for all indexers, only Cloudflare-protected ones
- Consider adding tags in Prowlarr to only route protected indexers through FlareSolverr

## Troubleshooting

### High CPU Usage

This is normal during challenge solving. If persistent, check for stuck browser sessions.

### Timeout Errors

Increase timeout in Prowlarr indexer settings or check network connectivity.

### Challenge Failed

Cloudflare may have updated their protection. Check for FlareSolverr updates.

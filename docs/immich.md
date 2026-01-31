# Immich

Immich is a self-hosted photo and video management solution with mobile apps, machine learning-powered search, and automatic backup.

## Official Documentation

- [Immich Website](https://immich.app/)
- [Immich Documentation](https://immich.app/docs/overview/introduction)
- [Immich GitHub](https://github.com/immich-app/immich)

## Components

Immich consists of multiple containers:

| Container                 | Description                               |
| ------------------------- | ----------------------------------------- |
| `immich-server`           | Main API and web server                   |
| `immich-machine-learning` | ML models for face recognition and search |
| `redis`                   | Caching layer                             |
| `database`                | PostgreSQL with vector extensions         |

## Ports

| Port | Protocol | Description    |
| ---- | -------- | -------------- |
| 2283 | TCP      | Web UI and API |

## Volumes

| Container               | Path                       | Description             |
| ----------------------- | -------------------------- | ----------------------- |
| immich-server           | `/data`                    | Photo and video uploads |
| database                | `/var/lib/postgresql/data` | Database storage        |
| immich-machine-learning | `/cache`                   | ML model cache          |

## Environment Variables

Required in `.env`:

```ini
# Immich version (or use 'release' for latest)
IMMICH_VERSION=release

# Upload location for photos/videos
UPLOAD_LOCATION=/path/to/photos

# Database credentials
DB_PASSWORD=your-secure-password
DB_USERNAME=postgres
DB_DATABASE_NAME=immich

# Database storage location
DB_DATA_LOCATION=/path/to/db
```

## Configuration

### Initial Setup

1. Access Immich at `http://<server-ip>:2283`
2. Create an admin account
3. Configure server settings

### Mobile App Setup

1. Download the Immich app (iOS/Android)
2. Enter server URL: `http://<server-ip>:2283`
3. Sign in with your account
4. Enable automatic backup

### External Libraries

To add existing photo directories:

1. Go to Administration → External Libraries
2. Add import path
3. Scan for new assets

### Machine Learning

The ML container provides:

- Face recognition and grouping
- Smart search by objects and scenes
- Duplicate detection

## Integration with Other Services

Immich is standalone but can integrate with:

- **Plex**: For photo viewing (though Immich's interface is better for photos)
- **File Browser**: Direct access to uploaded files

## Data Directories

```
${UPLOAD_LOCATION}/           # Photo and video storage
${DB_DATA_LOCATION}/          # PostgreSQL database
model-cache (Docker volume)   # ML models
```

## Backup

Important directories to backup:

1. Upload location (photos and videos)
2. Database (use `pg_dump` or volume backup)
3. `.env` file with credentials

## Tips

- Use external storage (NAS/HDD) for the upload location
- The ML container needs significant RAM (~4GB+)
- Initial library scan can take hours for large collections

# File Browser

File Browser is a web-based file manager that provides a clean interface for browsing, uploading, and managing files on your server.

## Official Documentation

- [File Browser Website](https://filebrowser.org/)
- [File Browser Documentation](https://filebrowser.org/features)
- [File Browser GitHub](https://github.com/filebrowser/filebrowser)

## Ports

| Port | Protocol | Description                       |
| ---- | -------- | --------------------------------- |
| 8181 | TCP      | Web UI (mapped from container 80) |

## Volumes

| Container Path | Description                      |
| -------------- | -------------------------------- |
| `/srv`         | Root directory for file browsing |
| `/config`      | Configuration files              |
| `/database`    | User database and settings       |

## Configuration

### Initial Setup

1. Access File Browser at `http://<server-ip>:8181`
2. Default credentials:
   - Username: `admin`
   - Password: `admin`
3. **Change the default password immediately**

### User Management

1. Go to Settings → User Management
2. Create users with specific permissions:
   - Admin: Full access
   - User: Limited to specific directories
   - Read-only: View only

### Features

- **File Operations**: Upload, download, rename, delete, move
- **Editor**: Built-in text editor for quick edits
- **Search**: Search files by name
- **Sharing**: Create shareable links for files
- **Archive**: Create/extract archives

### Security

If exposing externally:

1. Enable HTTPS
2. Use strong passwords
3. Consider enabling 2FA
4. Restrict user permissions

## Integration with Other Services

- Provides web access to the same data directory used by:
  - **Plex**: Media files
  - **Radarr/Sonarr**: Downloaded media
  - **qBittorrent**: Torrent downloads

## Data Directories

```
${APPDATA}/filebrowser/config/    # Configuration
${APPDATA}/filebrowser/database/  # User database
${DATA_DIR}/                       # Browsable files
```

## Tips

- Use File Browser to quickly check download progress
- Upload files directly to specific directories
- Create read-only users for sharing access
- Use the built-in terminal for quick commands (if enabled)

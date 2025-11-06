# MCP Server for FastAlert

A Model Context Protocol server that provides tools for discovering channels through the FastAlert API, with an optional search by name.

## Features

- Channels Listing:
  - List all channels.
  - Optional search by `name` parameter.
- Send Messages:
  - Send messages to one or multiple channels.
  - Required parameters: `channel-uuid`, `title`, `content`.
  - Optional parameters: `action`, `action_value`, `image`.

## Configuration

To obtain your FastAlert API key:
1. Going to https://fastalert.now/
2. Creating an account or sign in
3. Navigate to "Settings" in your account
4. Locate and copy your API key

Add your API key to your MCP settings file:

```json
{
  "mcpServers": {
    "fastalert-mcp": {
      "command": "npx",
      "args": [ "-y", "fastalert-mcp-server"],
      "env": {
        "API_KEY":"your-api-key"
      }
    }
  }
}
```

## Usage

## 1. The server provides the `list_channels` tool, which accepts:

### Optional Parameters
- `name`: Search term
### Examples

#### Structured JSON Output (Default)
```
{ 
  "status": true
    "message": "You have fetch channels successfully". 
    "data": {
      "channels": [
        {
          "uuid": "sdf12sdf-6541-5d56-s5sd-1fa513e88a87",
          "name": "My channels",
          "subscriber": 1000
        }
      ]
    }
}
```

#### Human-Readable Text Output
```
{ 
  "status": true
    "message": "You have fetch channels successfully". 
    "data": {
      "channels": [
        {
          "uuid": "sdf12sdf-6541-5d56-s5sd-1fa513e88a87",
          "name": "My channels",
          "subscriber": 1000
        }
      ]
    }
}
```


## 2. The server provides the `send_message` tool, which accepts:
### Required Parameters
- `channel-uuid`: Channel UUID
- `title`: Message title
- `content`: Message content

### Optional Parameters
- `action`: Type of action ('call', 'email', 'website', 'image')
- `action_value`: Action value corresponding to the action type
- `image`: Image
### Examples

#### Structured JSON Output (Default)
```
{ 
  "status": true,
  "message": "Message has been sent successfully"
}
```

#### Human-Readable Text Output
```
{ 
  "status": true,
  "message": "Message has been sent successfully"
}
```

## Development

1. Clone the repository
2. Copy the example environment file to create your own:
   ```bash
   cp .env.example .env
   ```
3. Add your FastAlert API key to `.env`
4. Install dependencies:
   ```bash
   npm install
   ```
5. Build the project:
   ```bash
   npm run build
   ```
6. Run inspector tests:
   ```bash
   npm run inspector
   ```
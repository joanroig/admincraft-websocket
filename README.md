<p align="center">
  <a href="https://github.com/joanroig/admincraft-websocket">
      <img alt="Admincraft WebSocket logo" src="https://raw.githubusercontent.com/joanroig/admincraft-websocket/main/logo.png" width="140px">
  </a>
</p>

<h1 align="center">
  Admincraft WebSocket
</h1>

<p align="center">
  WebSocket bridge to control Minecraft Bedrock and Java servers with <a href="https://github.com/joanroig/admincraft">Admincraft</a>.
</p>

<p align="center">
    <a href="https://github.com/joanroig/admincraft"><img src="https://img.shields.io/badge/Admincraft-339933?style=flat-square&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABfUlEQVR4AW2SvU5CQRCFJ2ZbKPCHiDWGhsJYGOgNnQVRW1ueQSsL34HW2khhR+i1MhY2RGswkgsFPIDcb+BsFuJJyHLn58ycmQnPt5d/k+ncwO9s4W+9emTbtnG2sMpeIfo/v0f+Bv6USwX7+BrHAJJ3auf2/vLoNgLLpbmTiRzCcTa0gCHbP7PKrOdEB7tFZ7fXXkz27zX6b0N/W42a24O3Oh14YPvhybqdlhOl1fTNuy0xxIo5endX1un2nQRIJ1XpBll0RrIk+wzQAzsOkiG5v266TclAM6EbyfMZmI1ii2ky3bUaxdhJvbrqSpIoGNT+fzOADLTXA5S0dB5BU+Y3yQNSJ50AfesmwMYMdAepE0h7mriSbC6bvCCHhiKnVgUZO9cNcFDgsNm2n3wjQXp1gemp4ju9uLHJcBCLQHhyXPFkthdI5g+BGFU5XmBuS6E1aisuQYw6HkHdUQAZuomNS9wO0mEB2bR/ChEreU6gagTq7jUkna2QrlhFl4X7LZs6I3I3AAAAAElFTkSuQmCC" alt="Admincraft badge"/></a>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=fff&style=flat-square" alt="Node.js badge"/></a>
    <a href="https://hub.docker.com/r/joanroig/admincraft-websocket"><img src="https://img.shields.io/docker/pulls/joanroig/admincraft-websocket?style=flat-square&logo=docker&label=Docker%20Pulls" alt="Docker Pulls"/></a>
    <a href="https://github.com/joanroig/admincraft-websocket/actions/workflows/build-and-release-docker-image.yml"><img src="https://img.shields.io/github/actions/workflow/status/joanroig/admincraft-websocket/build-and-release-docker-image.yml?style=flat-square&label=Build&logo=github" alt="Build and Push Docker Image"></a>
</p>

## What is Admincraft WebSocket?

Admincraft WebSocket allows remote control of Minecraft Bedrock and Java Edition servers. It exposes one authenticated WebSocket interface to Admincraft, then uses the Bedrock Docker console or Java RCON internally. Docker integration supplies live logs and lifecycle controls.

### Current Project Status

- Designed to work alongside [Admincraft](https://github.com/joanroig/admincraft) for GUI-based server management.
- Bedrock is optimized for [docker-minecraft-bedrock-server](https://github.com/itzg/docker-minecraft-bedrock-server); Java is optimized for [docker-minecraft-server](https://github.com/itzg/docker-minecraft-server).

## Issues

To open an issue, please use the [Admincraft's issues page](https://github.com/joanroig/admincraft/issues/new/choose).

## Getting Started

### Prerequisites

To run Admincraft WebSocket, ensure you have the [Docker](https://www.docker.com/) installed.

### Network security

This server executes commands on your Minecraft container, so port `8080` should never be reachable from the internet unprotected. The recommended setup is to reach it over [Tailscale](https://tailscale.com), which places your devices on a private encrypted network: keep `USE_SSL` set to `"false"`, leave the port closed in your cloud firewall, and connect Admincraft to the server's Tailscale address with an empty certificate field.

If you do need the port publicly reachable, enable `USE_SSL` and generate certificates as described in the [server setup guide](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md#alternative-public-access-with-self-signed-ssl). Never expose port `8080` with SSL disabled: Admincraft falls back to an unencrypted connection when no certificate is provided, sending your secret key and every command in clear text.

### Installation

Choose the setup for your edition:

- [Bedrock Edition setup](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md)
- [Java Edition setup](https://github.com/joanroig/admincraft/blob/main/docs/getting-started/java-server.md)

The bridge configuration variables are:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | optional legacy admin key | Backwards-compatible key with full command and lifecycle access |
| `ADMIN_SECRET_KEY` | optional | Full Minecraft command and container lifecycle access; takes precedence over `SECRET_KEY` |
| `COMMAND_SECRET_KEY` | optional | Minecraft commands and diagnostics, without container start/stop/restart |
| `READ_ONLY_SECRET_KEY` | optional | Logs, status, health, version, uptime, and diagnostics only |
| `SERVER_TYPE` | `bedrock` | `bedrock` or `java` |
| `MC_NAME` | `minecraft` | Minecraft Docker container name |
| `RCON_HOST` | `MC_NAME` | Java RCON hostname |
| `RCON_PORT` | `25575` | Java RCON port |
| `RCON_PASSWORD` | required for Java | Password configured on the Java server |
| `DOCKER_ENABLED` | `true` | Set to `false` for Java RCON commands without Docker logs or container start/stop/restart controls |
| `USE_SSL` | `false` | Serve the WebSocket with the mounted TLS certificate |
| `PORT` | `8080` | WebSocket listen port |

Configure at least one bridge access key. Use a different random value for each
scope you enable, and give each Admincraft profile the least powerful key it
needs. Never publish the Java RCON port. Keep it inside the Docker network and
expose only the protected Admincraft WebSocket endpoint.

| Access key | Read logs and diagnostics | Minecraft commands | Start, stop, restart container |
| --- | --- | --- | --- |
| `READ_ONLY_SECRET_KEY` | Yes | No | No |
| `COMMAND_SECRET_KEY` | Yes | Yes | No |
| `ADMIN_SECRET_KEY` or legacy `SECRET_KEY` | Yes | Yes | Yes |

### Admincraft bridge commands

The app exposes the commands allowed by the connected key in terminal
completion:

| Command | Result |
| --- | --- |
| `admincraft help` | Lists commands allowed by the current key |
| `admincraft status` | Minecraft container state |
| `admincraft health` | Docker healthcheck state, or Java RCON reachability when Docker is disabled |
| `admincraft info` | Bridge version, protocol, permission, edition, container, status, uptime, and capabilities |
| `admincraft uptime` | Time since the Minecraft container started |
| `admincraft version` | Installed Admincraft WebSocket version |
| `admincraft logs [count]` | Replays 1–1000 recent server log lines; defaults to 250 |
| `admincraft start-server` | Starts the Minecraft container (admin key only) |
| `admincraft stop-server` | Stops the Minecraft container (admin key only) |
| `admincraft restart-server` | Restarts the Minecraft container (admin key only) |

Protocol-v2 clients also receive a capability list, a bounded log snapshot
before the live stream, and structured container, world-time, and player-count
changes. Admincraft uses these events to hide unavailable controls and keep
its overview and diagnostics current without injecting status command replies
into the visible console.

You can set up your server following [the server setup guide from Admincraft](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md), in summary you need to:

1. **Set up your environment:**

   Get the [docker-compose.yml](https://github.com/joanroig/admincraft/blob/main/docs/server/docker-compose.yml) file and edit it with your secret key:

   `SECRET_KEY=your_secret_key_here`

   Define minecraft container name for websocket, if it is not "minecraft":
   `MC_NAME=YOUR_MINECRAFT_CONTAINER_NAME`

2. **Build and run the Docker container:**

   `sudo docker-compose up --build`

   The WebSocket server will be available on port `8080`.

## Development

### Running Locally

1. **Run a demo container**

   `sudo docker run -p 8080:8080 --name admincraft-websocket -e SECRET_KEY=your_secret_key_here admincraft-websocket`

2. The server will start on port `8080` by default.

### Running together with docker compose

Change the websocket service in the `docker-compose.yml` file to remove the image configuration and add the build configuration to point to the local folder with the project code:

```
version: "3"
services:

  [...]

  websocket:
    container_name: websocket
    build:
      context: ./admincraft-websocket
      dockerfile: Dockerfileadmincraft-websocket:latest
    restart: always
    depends_on:
      # Make sure the minecraft service starts before the websockets service
      minecraft:
        condition: service_healthy
    ports:
      - 8080:8080
    volumes:
      # Mount Docker socket
      - /var/run/docker.sock:/var/run/docker.sock
      # Needed if environment.USE_SSL is "true"
      - ./certs:/usr/src/app/certs:ro
    environment:
      # Login password to use in admincraft (use alphanumeric characters only)
      SECRET_KEY: YOUR_SECRET_KEY_HERE
      # Enable or disable SSL
      USE_SSL: "false"
```

You can also run a separate docker compose file by providing it:
`sudo docker compose -f docker-compose_ssl.yml up -d`

#### Troubleshoot

You can stop the servers, remove all containers and all images with:

```
sudo docker compose down
sudo docker rm -vf $(sudo docker ps -aq)
sudo docker rmi -f $(sudo docker images -aq)
```

### Multi-architecture Docker Build & Push

#### Automated Builds with GitHub Actions

This repository includes a GitHub Actions workflow that automatically builds and pushes multi-architecture Docker images to Docker Hub when changes are pushed to the main branch.

To set this up:

1. **Add Docker Hub secrets to your GitHub repository:**

   - Go to your repository's Settings > Secrets and variables > Actions
   - Add these secrets:
     - `DOCKERHUB_USERNAME`: Your Docker Hub username
     - `DOCKERHUB_TOKEN`: A Docker Hub access token (create one at [Docker Hub Account Settings](https://hub.docker.com/settings/security))

2. **Push changes to the main branch or manually trigger the workflow:**
   - The workflow will automatically run when you push to the main branch
   - You can also manually trigger it from the Actions tab in your repository

#### Manual Build Process

If you prefer to build and push the Docker image manually:

1. **Install Docker Buildx (if not already installed):**

   Ensure Docker Buildx is available:

   `sudo docker buildx create --use`

2. **Create or use a multi-architecture builder:**

   Create a new builder instance:

   `sudo docker buildx create --name admincraft-websocket-builder --use --driver docker-container`

   To use an existing instance:

   `sudo docker buildx use admincraft-websocket-builder`

3. **Build the Docker images for both architectures:**

   Use the following command to build and push images for both `amd64` and `arm64`:

   `sudo docker buildx build --platform linux/amd64,linux/arm64 -t your-docker-username/admincraft-websocket:latest --push .`

4. **Verify the images on Docker Hub:**

   After the build is complete, check your Docker Hub repository to ensure both architectures are available.

### Architecture

The Admincraft WebSocket Server operates alongside a Minecraft Bedrock or Java server. Architecture details can be found in the [Bedrock setup guide](https://github.com/joanroig/admincraft/blob/main/docs/server/SERVER_SETUP.md#architecture) and [Java setup guide](https://github.com/joanroig/admincraft/blob/main/docs/getting-started/java-server.md).

## License

Admincraft WebSocket version 1.1.0 and later is source-available under the
[PolyForm Shield License 1.0.0](https://github.com/joanroig/admincraft-websocket/blob/main/LICENSE.md).
See [LICENSING.md](https://github.com/joanroig/admincraft-websocket/blob/main/LICENSING.md)
for the version boundary and third-party components.

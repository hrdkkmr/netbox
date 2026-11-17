#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define SERVER_IP "127.0.0.1"
#define SERVER_PORT 8080
#define LISTEN_BACKLOG 5
#define BUFFER_SIZE 4096

static volatile sig_atomic_t keep_running = 1;

static void handle_shutdown_signal(int signum) {
    (void)signum;
    keep_running = 0;
}

/*
 * Sends all `length` bytes over `sockfd`, retrying on EINTR and handling
 * partial writes that can occur on stream (TCP) sockets.
 * Returns 0 on success, -1 on error.
 */
static int send_all(int sockfd, const char *buffer, size_t length) {
    size_t total_sent = 0;

    while (total_sent < length) {
        ssize_t sent = send(sockfd, buffer + total_sent, length - total_sent, 0);
        if (sent < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (sent == 0) {
            return -1;
        }
        total_sent += (size_t)sent;
    }

    return 0;
}

static int install_signal_handlers(void) {
    /* Ignore SIGPIPE so a client disconnecting mid-send returns EPIPE instead of terminating the server. */
    struct sigaction ignore_action;
    memset(&ignore_action, 0, sizeof(ignore_action));
    ignore_action.sa_handler = SIG_IGN;
    if (sigaction(SIGPIPE, &ignore_action, NULL) < 0) {
        perror("sigaction(SIGPIPE)");
        return -1;
    }

    /* Handle SIGINT/SIGTERM without SA_RESTART so blocking accept() exits cleanly. */
    struct sigaction stop_action;
    memset(&stop_action, 0, sizeof(stop_action));
    stop_action.sa_handler = handle_shutdown_signal;
    sigemptyset(&stop_action.sa_mask);
    if (sigaction(SIGINT, &stop_action, NULL) < 0) {
        perror("sigaction(SIGINT)");
        return -1;
    }
    if (sigaction(SIGTERM, &stop_action, NULL) < 0) {
        perror("sigaction(SIGTERM)");
        return -1;
    }

    return 0;
}

static void handle_client(int client_fd, const struct sockaddr_in *client_addr) {
    char client_ip[INET_ADDRSTRLEN] = "unknown";
    inet_ntop(AF_INET, &client_addr->sin_addr, client_ip, sizeof(client_ip));
    unsigned short client_port = ntohs(client_addr->sin_port);

    printf("[server] Accepted connection from %s:%u (fd=%d)\n",
           client_ip, client_port, client_fd);
    fflush(stdout);

    char buffer[BUFFER_SIZE];
    while (keep_running) {
        ssize_t bytes_received = recv(client_fd, buffer, sizeof(buffer), 0);
        if (bytes_received < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("[server] recv");
            break;
        }
        if (bytes_received == 0) {
            /* Peer closed its write side cleanly (TCP FIN). */
            printf("[server] Client %s:%u closed the connection.\n",
                   client_ip, client_port);
            break;
        }

        printf("[server] Received %zd byte(s) from %s:%u: \"%.*s\"\n",
               bytes_received, client_ip, client_port,
               (int)bytes_received, buffer);

        if (send_all(client_fd, buffer, (size_t)bytes_received) < 0) {
            perror("[server] send");
            break;
        }

        printf("[server] Echoed %zd byte(s) back to %s:%u\n",
               bytes_received, client_ip, client_port);
        fflush(stdout);
    }

    if (close(client_fd) < 0) {
        perror("[server] close(client_fd)");
    } else {
        printf("[server] Closed client socket (fd=%d)\n", client_fd);
    }
    fflush(stdout);
}

int main(void) {
    if (install_signal_handlers() < 0) {
        return EXIT_FAILURE;
    }

    /* 1. Create a TCP/IPv4 socket. */
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("[server] socket");
        return EXIT_FAILURE;
    }

    /* Allow immediate reuse of 127.0.0.1:8080 if a prior socket is in TIME_WAIT. */
    int reuse_addr = 1;
    if (setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &reuse_addr, sizeof(reuse_addr)) < 0) {
        perror("[server] setsockopt(SO_REUSEADDR)");
        close(server_fd);
        return EXIT_FAILURE;
    }

    /* 2. Configure and bind to 127.0.0.1:8080. */
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    if (inet_pton(AF_INET, SERVER_IP, &server_addr.sin_addr) != 1) {
        fprintf(stderr, "[server] Invalid IPv4 address: %s\n", SERVER_IP);
        close(server_fd);
        return EXIT_FAILURE;
    }

    if (bind(server_fd, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
        perror("[server] bind");
        close(server_fd);
        return EXIT_FAILURE;
    }

    /* 3. Mark the socket as passive to accept incoming TCP connections. */
    if (listen(server_fd, LISTEN_BACKLOG) < 0) {
        perror("[server] listen");
        close(server_fd);
        return EXIT_FAILURE;
    }

    printf("[server] Listening on %s:%d (Ctrl+C to stop)...\n",
           SERVER_IP, SERVER_PORT);
    fflush(stdout);

    /* 4. Sequentially accept and serve incoming clients until shutdown signal. */
    while (keep_running) {
        struct sockaddr_in client_addr;
        socklen_t client_addr_len = sizeof(client_addr);

        int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_addr_len);
        if (client_fd < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("[server] accept");
            break;
        }

        handle_client(client_fd, &client_addr);
    }

    printf("[server] Shutting down listening socket (fd=%d).\n", server_fd);
    if (close(server_fd) < 0) {
        perror("[server] close(server_fd)");
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}

#ifndef NETBOX_SOCKET_METADATA_H
#define NETBOX_SOCKET_METADATA_H

#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <stdint.h>

#define MAX_TRACKED_FDS 4096
#define IP_STR_MAX_LEN 46

typedef struct {
    int in_use;
    int fd;
    int domain;
    int type;
    int protocol;
    int is_listening;
    char local_ip[IP_STR_MAX_LEN];
    int local_port;
    char remote_ip[IP_STR_MAX_LEN];
    int remote_port;
} socket_info_t;

void socket_metadata_init(void);
void socket_metadata_cleanup(void);

void socket_metadata_track_socket(int fd, int domain, int type, int protocol);
void socket_metadata_set_local(int fd, const struct sockaddr *addr, socklen_t addrlen);
void socket_metadata_set_remote(int fd, const struct sockaddr *addr, socklen_t addrlen);
void socket_metadata_set_listening(int fd, int is_listening);
int  socket_metadata_get(int fd, socket_info_t *out_info);
void socket_metadata_untrack(int fd);
int  socket_metadata_is_tracked(int fd);
void socket_metadata_refresh_endpoints(int fd);

const char *socket_domain_to_str(int domain);
const char *socket_type_to_str(int type);

#endif /* NETBOX_SOCKET_METADATA_H */

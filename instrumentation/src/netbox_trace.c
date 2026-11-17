#define _GNU_SOURCE
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"

#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#include "event_writer.h"
#include "socket_metadata.h"

/* Real function pointers */
static int (*real_socket)(int domain, int type, int protocol) = NULL;
static int (*real_bind)(int sockfd, const struct sockaddr *addr, socklen_t addrlen) = NULL;
static int (*real_listen)(int sockfd, int backlog) = NULL;
static int (*real_accept)(int sockfd, struct sockaddr *addr, socklen_t *addrlen) = NULL;
static int (*real_accept4)(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags) = NULL;
static int (*real_connect)(int sockfd, const struct sockaddr *addr, socklen_t addrlen) = NULL;
static ssize_t (*real_send)(int sockfd, const void *buf, size_t len, int flags) = NULL;
static ssize_t (*real_sendto)(int sockfd, const void *buf, size_t len, int flags,
                              const struct sockaddr *dest_addr, socklen_t addrlen) = NULL;
static ssize_t (*real_recv)(int sockfd, void *buf, size_t len, int flags) = NULL;
static ssize_t (*real_recvfrom)(int sockfd, void *buf, size_t len, int flags,
                                struct sockaddr *src_addr, socklen_t *addrlen) = NULL;
static int (*real_shutdown)(int sockfd, int how) = NULL;
static int (*real_close)(int fd) = NULL;

/* Thread-local re-entrancy guard */
static __thread int in_trace_hook = 0;

static inline uint64_t get_timestamp_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ULL + (uint64_t)ts.tv_nsec;
}

static void init_real_functions(void) {
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
    if (!real_socket)   *(void **)(&real_socket)   = dlsym(RTLD_NEXT, "socket");
    if (!real_bind)     *(void **)(&real_bind)     = dlsym(RTLD_NEXT, "bind");
    if (!real_listen)   *(void **)(&real_listen)   = dlsym(RTLD_NEXT, "listen");
    if (!real_accept)   *(void **)(&real_accept)   = dlsym(RTLD_NEXT, "accept");
    if (!real_accept4)  *(void **)(&real_accept4)  = dlsym(RTLD_NEXT, "accept4");
    if (!real_connect)  *(void **)(&real_connect)  = dlsym(RTLD_NEXT, "connect");
    if (!real_send)     *(void **)(&real_send)     = dlsym(RTLD_NEXT, "send");
    if (!real_sendto)   *(void **)(&real_sendto)   = dlsym(RTLD_NEXT, "sendto");
    if (!real_recv)     *(void **)(&real_recv)     = dlsym(RTLD_NEXT, "recv");
    if (!real_recvfrom) *(void **)(&real_recvfrom) = dlsym(RTLD_NEXT, "recvfrom");
    if (!real_shutdown) *(void **)(&real_shutdown) = dlsym(RTLD_NEXT, "shutdown");
    if (!real_close)    *(void **)(&real_close)    = dlsym(RTLD_NEXT, "close");
#pragma GCC diagnostic pop
}

__attribute__((constructor))
static void netbox_trace_init(void) {
    init_real_functions();
    socket_metadata_init();
    event_writer_init();
}

__attribute__((destructor))
static void netbox_trace_fini(void) {
    event_writer_cleanup();
    socket_metadata_cleanup();
}

/* ----------------- Intercepted Functions ----------------- */

int socket(int domain, int type, int protocol) {
    if (in_trace_hook || !real_socket) {
        init_real_functions();
        return real_socket ? real_socket(domain, type, protocol) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int res = real_socket(domain, type, protocol);
    int saved_errno = errno;

    if (res >= 0) {
        socket_metadata_track_socket(res, domain, type, protocol);
    }

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "socket";
    ev.socket_fd = res;
    ev.socket_domain = socket_domain_to_str(domain);
    ev.socket_type = socket_type_to_str(type);
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    if (in_trace_hook || !real_bind) {
        init_real_functions();
        return real_bind ? real_bind(sockfd, addr, addrlen) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int res = real_bind(sockfd, addr, addrlen);
    int saved_errno = errno;

    if (res == 0 && addr) {
        socket_metadata_set_local(sockfd, addr, addrlen);
    }

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "bind";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

int listen(int sockfd, int backlog) {
    if (in_trace_hook || !real_listen) {
        init_real_functions();
        return real_listen ? real_listen(sockfd, backlog) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int res = real_listen(sockfd, backlog);
    int saved_errno = errno;

    if (res == 0) {
        socket_metadata_set_listening(sockfd, 1);
    }

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "listen";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen) {
    if (in_trace_hook || !real_accept) {
        init_real_functions();
        return real_accept ? real_accept(sockfd, addr, addrlen) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int client_fd = real_accept(sockfd, addr, addrlen);
    int saved_errno = errno;

    socket_info_t server_info;
    int has_server = socket_metadata_get(sockfd, &server_info);

    if (client_fd >= 0) {
        socket_metadata_track_socket(client_fd,
                                     has_server ? server_info.domain : AF_INET,
                                     has_server ? server_info.type : SOCK_STREAM,
                                     has_server ? server_info.protocol : 0);

        if (addr && addrlen) {
            socket_metadata_set_remote(client_fd, addr, *addrlen);
        }
        socket_metadata_refresh_endpoints(client_fd);
    }

    socket_info_t client_info;
    int has_client = (client_fd >= 0) ? socket_metadata_get(client_fd, &client_info) : 0;

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "accept";
    ev.socket_fd = client_fd >= 0 ? client_fd : sockfd;
    ev.socket_domain = has_server ? socket_domain_to_str(server_info.domain) : NULL;
    ev.socket_type = has_server ? socket_type_to_str(server_info.type) : NULL;
    ev.local_ip = has_client ? client_info.local_ip : (has_server ? server_info.local_ip : NULL);
    ev.local_port = has_client ? client_info.local_port : (has_server ? server_info.local_port : -1);
    ev.remote_ip = has_client ? client_info.remote_ip : NULL;
    ev.remote_port = has_client ? client_info.remote_port : -1;
    ev.bytes_transferred = -1;
    ev.result = client_fd;
    ev.error_code = (client_fd < 0) ? saved_errno : 0;
    ev.error_name = (client_fd < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (client_fd < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return client_fd;
}

int accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags) {
    if (in_trace_hook || !real_accept4) {
        init_real_functions();
        return real_accept4 ? real_accept4(sockfd, addr, addrlen, flags) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int client_fd = real_accept4(sockfd, addr, addrlen, flags);
    int saved_errno = errno;

    socket_info_t server_info;
    int has_server = socket_metadata_get(sockfd, &server_info);

    if (client_fd >= 0) {
        socket_metadata_track_socket(client_fd,
                                     has_server ? server_info.domain : AF_INET,
                                     has_server ? server_info.type : SOCK_STREAM,
                                     has_server ? server_info.protocol : 0);

        if (addr && addrlen) {
            socket_metadata_set_remote(client_fd, addr, *addrlen);
        }
        socket_metadata_refresh_endpoints(client_fd);
    }

    socket_info_t client_info;
    int has_client = (client_fd >= 0) ? socket_metadata_get(client_fd, &client_info) : 0;

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "accept4";
    ev.socket_fd = client_fd >= 0 ? client_fd : sockfd;
    ev.socket_domain = has_server ? socket_domain_to_str(server_info.domain) : NULL;
    ev.socket_type = has_server ? socket_type_to_str(server_info.type) : NULL;
    ev.local_ip = has_client ? client_info.local_ip : (has_server ? server_info.local_ip : NULL);
    ev.local_port = has_client ? client_info.local_port : (has_server ? server_info.local_port : -1);
    ev.remote_ip = has_client ? client_info.remote_ip : NULL;
    ev.remote_port = has_client ? client_info.remote_port : -1;
    ev.bytes_transferred = -1;
    ev.result = client_fd;
    ev.error_code = (client_fd < 0) ? saved_errno : 0;
    ev.error_name = (client_fd < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (client_fd < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return client_fd;
}

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    if (in_trace_hook || !real_connect) {
        init_real_functions();
        return real_connect ? real_connect(sockfd, addr, addrlen) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    if (addr) {
        socket_metadata_set_remote(sockfd, addr, addrlen);
    }

    int res = real_connect(sockfd, addr, addrlen);
    int saved_errno = errno;

    if (res == 0) {
        socket_metadata_refresh_endpoints(sockfd);
    }

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "connect";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

ssize_t send(int sockfd, const void *buf, size_t len, int flags) {
    if (in_trace_hook || !real_send) {
        init_real_functions();
        return real_send ? real_send(sockfd, buf, len, flags) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    ssize_t res = real_send(sockfd, buf, len, flags);
    int saved_errno = errno;

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "send";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = (res >= 0) ? res : -1;
    ev.result = (int64_t)res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
               const struct sockaddr *dest_addr, socklen_t addrlen) {
    if (in_trace_hook || !real_sendto) {
        init_real_functions();
        return real_sendto ? real_sendto(sockfd, buf, len, flags, dest_addr, addrlen) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    if (dest_addr) {
        socket_metadata_set_remote(sockfd, dest_addr, addrlen);
    }

    ssize_t res = real_sendto(sockfd, buf, len, flags, dest_addr, addrlen);
    int saved_errno = errno;

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "sendto";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = (res >= 0) ? res : -1;
    ev.result = (int64_t)res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

ssize_t recv(int sockfd, void *buf, size_t len, int flags) {
    if (in_trace_hook || !real_recv) {
        init_real_functions();
        return real_recv ? real_recv(sockfd, buf, len, flags) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    ssize_t res = real_recv(sockfd, buf, len, flags);
    int saved_errno = errno;

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "recv";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = (res >= 0) ? res : -1;
    ev.result = (int64_t)res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags,
                 struct sockaddr *src_addr, socklen_t *addrlen) {
    if (in_trace_hook || !real_recvfrom) {
        init_real_functions();
        return real_recvfrom ? real_recvfrom(sockfd, buf, len, flags, src_addr, addrlen) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    ssize_t res = real_recvfrom(sockfd, buf, len, flags, src_addr, addrlen);
    int saved_errno = errno;

    if (res >= 0 && src_addr && addrlen) {
        socket_metadata_set_remote(sockfd, src_addr, *addrlen);
    }

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "recvfrom";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = (res >= 0) ? res : -1;
    ev.result = (int64_t)res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

int shutdown(int sockfd, int how) {
    if (in_trace_hook || !real_shutdown) {
        init_real_functions();
        return real_shutdown ? real_shutdown(sockfd, how) : -1;
    }

    in_trace_hook = 1;
    uint64_t ts = get_timestamp_ns();

    int res = real_shutdown(sockfd, how);
    int saved_errno = errno;

    socket_info_t sinfo;
    int has_info = socket_metadata_get(sockfd, &sinfo);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "shutdown";
    ev.socket_fd = sockfd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

int close(int fd) {
    if (in_trace_hook || !real_close) {
        init_real_functions();
        return real_close ? real_close(fd) : -1;
    }

    // Do not close our internal event writer FD
    if (fd == event_writer_get_fd() && fd >= 0) {
        return 0;
    }

    in_trace_hook = 1;

    // Check if this fd is a tracked socket or if it's a socket via getsockopt
    int is_socket = socket_metadata_is_tracked(fd);
    if (!is_socket) {
        int optval = 0;
        socklen_t optlen = sizeof(optval);
        if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &optval, &optlen) == 0) {
            is_socket = 1;
        }
    }

    if (!is_socket) {
        // Not a socket: call real_close without logging socket_api event
        in_trace_hook = 0;
        return real_close(fd);
    }

    uint64_t ts = get_timestamp_ns();
    socket_info_t sinfo;
    int has_info = socket_metadata_get(fd, &sinfo);

    int res = real_close(fd);
    int saved_errno = errno;

    socket_metadata_untrack(fd);

    event_data_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = ts;
    ev.event_type = "close";
    ev.socket_fd = fd;
    ev.socket_domain = has_info ? socket_domain_to_str(sinfo.domain) : NULL;
    ev.socket_type = has_info ? socket_type_to_str(sinfo.type) : NULL;
    ev.local_ip = has_info ? sinfo.local_ip : NULL;
    ev.local_port = has_info ? sinfo.local_port : -1;
    ev.remote_ip = has_info ? sinfo.remote_ip : NULL;
    ev.remote_port = has_info ? sinfo.remote_port : -1;
    ev.bytes_transferred = -1;
    ev.result = res;
    ev.error_code = (res < 0) ? saved_errno : 0;
    ev.error_name = (res < 0) ? errno_to_symbolic_name(saved_errno) : NULL;
    ev.error_message = (res < 0) ? strerror(saved_errno) : NULL;

    event_writer_write_event(&ev);

    in_trace_hook = 0;
    errno = saved_errno;
    return res;
}

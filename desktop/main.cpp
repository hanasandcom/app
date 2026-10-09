#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>

#ifdef _WIN32
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")
using socket_t = SOCKET;
static constexpr socket_t invalid_socket_value = INVALID_SOCKET;
static void close_socket(socket_t socket_fd) { closesocket(socket_fd); }
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
static constexpr socket_t invalid_socket_value = -1;
static void close_socket(socket_t socket_fd) { close(socket_fd); }
#endif

namespace {
auto started_at = std::chrono::steady_clock::now();

std::string json_escape(const std::string& value) {
    std::ostringstream out;
    for (char ch : value) {
        switch (ch) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: out << ch; break;
        }
    }
    return out.str();
}

std::string platform_name() {
#ifdef _WIN32
    return "Windows";
#elif __APPLE__
    return "macOS";
#elif __linux__
    return "Linux";
#else
    return "Unknown";
#endif
}

std::string hostname() {
    char buffer[256] = {0};
#ifdef _WIN32
    DWORD size = sizeof(buffer);
    if (GetComputerNameA(buffer, &size)) return buffer;
#else
    if (gethostname(buffer, sizeof(buffer) - 1) == 0) return buffer;
#endif
    return "localhost";
}

std::string current_user() {
    const char* user = std::getenv("USER");
    if (!user) user = std::getenv("USERNAME");
    return user ? user : "unknown";
}

long long uptime_seconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::steady_clock::now() - started_at).count();
}

std::string timestamp_seconds() {
    return std::to_string(std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
}

std::string status_json(const std::string& message = "ready") {
    std::ostringstream body;
    body
        << "{"
        << "\"ok\":true,"
        << "\"agent\":\"hanasand-desktop-agent\","
        << "\"message\":\"" << json_escape(message) << "\","
        << "\"hostname\":\"" << json_escape(hostname()) << "\","
        << "\"platform\":\"" << json_escape(platform_name()) << "\","
        << "\"user\":\"" << json_escape(current_user()) << "\","
        << "\"cwd\":\"" << json_escape(std::filesystem::current_path().string()) << "\","
        << "\"uptimeSeconds\":" << uptime_seconds() << ","
        << "\"timestamp\":\"" << timestamp_seconds() << "\""
        << "}";
    return body.str();
}

std::string error_json(const std::string& message) {
    return "{\"ok\":false,\"message\":\"" + json_escape(message) + "\"}";
}

std::string http_response(const std::string& body, int status = 200, const std::string& status_text = "OK") {
    std::ostringstream response;
    response
        << "HTTP/1.1 " << status << " " << status_text << "\r\n"
        << "Content-Type: application/json\r\n"
        << "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        << "Access-Control-Allow-Headers: Content-Type, Authorization, id\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Connection: close\r\n\r\n"
        << body;
    return response.str();
}

std::string read_request(socket_t client) {
    std::string request;
    char buffer[4096];
    int received = 0;
    do {
#ifdef _WIN32
        received = recv(client, buffer, sizeof(buffer), 0);
#else
        received = static_cast<int>(recv(client, buffer, sizeof(buffer), 0));
#endif
        if (received > 0) request.append(buffer, buffer + received);
    } while (received == static_cast<int>(sizeof(buffer)) && request.size() < 65536);
    return request;
}

void send_all(socket_t client, const std::string& response) {
    const char* data = response.data();
    size_t remaining = response.size();
    while (remaining > 0) {
#ifdef _WIN32
        int sent = send(client, data, static_cast<int>(remaining), 0);
#else
        ssize_t sent = send(client, data, remaining, 0);
#endif
        if (sent <= 0) return;
        data += sent;
        remaining -= static_cast<size_t>(sent);
    }
}

void handle_client(socket_t client) {
    const std::string request = read_request(client);
    std::string response;

    if (request.rfind("OPTIONS ", 0) == 0) {
        response = http_response("{}", 204, "No Content");
    } else if (request.rfind("GET /health ", 0) == 0 || request.rfind("GET /status ", 0) == 0) {
        response = http_response(status_json("this pc is reachable"));
    } else if (request.rfind("POST /command ", 0) == 0) {
        if (request.find("status") != std::string::npos) {
            response = http_response(status_json("status command executed"));
        } else {
            response = http_response(error_json("Command not allowed. Allowed command: status."), 400, "Bad Request");
        }
    } else {
        response = http_response(error_json("Route not found."), 404, "Not Found");
    }

    send_all(client, response);
    close_socket(client);
}
}

int main(int argc, char** argv) {
    int port = 45731;
    if (argc > 1) {
        port = std::atoi(argv[1]);
        if (port <= 0) port = 45731;
    }

#ifdef _WIN32
    WSADATA wsa_data;
    if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
        std::cerr << "WSAStartup failed\n";
        return 1;
    }
#endif

    socket_t server = socket(AF_INET, SOCK_STREAM, 0);
    if (server == invalid_socket_value) {
        std::cerr << "Unable to create socket\n";
        return 1;
    }

    int enabled = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&enabled), sizeof(enabled));

    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<uint16_t>(port));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

    if (bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        std::cerr << "Unable to bind 127.0.0.1:" << port << "\n";
        close_socket(server);
        return 1;
    }

    if (listen(server, 16) < 0) {
        std::cerr << "Unable to listen\n";
        close_socket(server);
        return 1;
    }

    std::cout << "Hanasand desktop agent listening on http://127.0.0.1:" << port << "\n";

    while (true) {
        sockaddr_in client_address {};
#ifdef _WIN32
        int client_length = sizeof(client_address);
#else
        socklen_t client_length = sizeof(client_address);
#endif
        socket_t client = accept(server, reinterpret_cast<sockaddr*>(&client_address), &client_length);
        if (client == invalid_socket_value) {
            continue;
        }
        std::thread(handle_client, client).detach();
    }
}

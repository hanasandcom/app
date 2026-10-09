import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct HanasandDesktopSettings: Codable, Equatable {
    static let macMiniTunnelCommand = "ssh -N -L 5900:192.168.1.81:5900 -J tekkom@128.39.140.144 tekkom@192.168.1.81"

    var websiteBaseURL = "https://hanasand.com"
    var apiBaseURL = "https://api.hanasand.com/api"
    var internalAPIBaseURL = "https://internal.hanasand.com/api"
    var cdnBaseURL = "https://cdn.hanasand.com/api"
    var authToken = ""
    var userID = ""
    var impersonationToken = ""
    var impersonatingUserID = ""
    var impersonatingUserName = ""
    var codexAPIPath = "/tools/ai"
    var aiAPIURL = "https://api.hanasand.com/api/tools/ai"
    var desktopAgentBaseURL = "http://localhost:45731"
    var vpnURLScheme = "ciscoanyconnect://"
    var rdpHost = "localhost:5900"
    var rdpUser = "macmini"
    var remoteDesktopProtocol = RemoteDesktopProtocol.screenSharing.rawValue
    var remoteDesktopTunnelCommand = Self.macMiniTunnelCommand
    var serverBaseURL = ""
    var serverStartPath = "/start"
    var serverStopPath = "/stop"
    var serverLogsPath = "/logs"

    enum CodingKeys: String, CodingKey {
        case websiteBaseURL
        case apiBaseURL
        case internalAPIBaseURL
        case cdnBaseURL
        case authToken
        case userID
        case impersonationToken
        case impersonatingUserID
        case impersonatingUserName
        case codexAPIPath
        case aiAPIURL
        case desktopAgentBaseURL
        case vpnURLScheme
        case rdpHost
        case rdpUser
        case remoteDesktopProtocol
        case remoteDesktopTunnelCommand
        case serverBaseURL
        case serverStartPath
        case serverStopPath
        case serverLogsPath
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        websiteBaseURL = try container.decodeIfPresent(String.self, forKey: .websiteBaseURL) ?? websiteBaseURL
        apiBaseURL = try container.decodeIfPresent(String.self, forKey: .apiBaseURL) ?? apiBaseURL
        internalAPIBaseURL = try container.decodeIfPresent(String.self, forKey: .internalAPIBaseURL) ?? internalAPIBaseURL
        cdnBaseURL = try container.decodeIfPresent(String.self, forKey: .cdnBaseURL) ?? cdnBaseURL
        authToken = try container.decodeIfPresent(String.self, forKey: .authToken) ?? authToken
        userID = try container.decodeIfPresent(String.self, forKey: .userID) ?? userID
        impersonationToken = try container.decodeIfPresent(String.self, forKey: .impersonationToken) ?? impersonationToken
        impersonatingUserID = try container.decodeIfPresent(String.self, forKey: .impersonatingUserID) ?? impersonatingUserID
        impersonatingUserName = try container.decodeIfPresent(String.self, forKey: .impersonatingUserName) ?? impersonatingUserName
        codexAPIPath = try container.decodeIfPresent(String.self, forKey: .codexAPIPath) ?? codexAPIPath
        aiAPIURL = try container.decodeIfPresent(String.self, forKey: .aiAPIURL) ?? aiAPIURL
        desktopAgentBaseURL = try container.decodeIfPresent(String.self, forKey: .desktopAgentBaseURL) ?? desktopAgentBaseURL
        vpnURLScheme = try container.decodeIfPresent(String.self, forKey: .vpnURLScheme) ?? vpnURLScheme
        rdpHost = try container.decodeIfPresent(String.self, forKey: .rdpHost) ?? rdpHost
        rdpUser = try container.decodeIfPresent(String.self, forKey: .rdpUser) ?? rdpUser
        remoteDesktopProtocol = try container.decodeIfPresent(String.self, forKey: .remoteDesktopProtocol) ?? remoteDesktopProtocol
        remoteDesktopTunnelCommand = try container.decodeIfPresent(String.self, forKey: .remoteDesktopTunnelCommand) ?? remoteDesktopTunnelCommand
        serverBaseURL = try container.decodeIfPresent(String.self, forKey: .serverBaseURL) ?? serverBaseURL
        serverStartPath = try container.decodeIfPresent(String.self, forKey: .serverStartPath) ?? serverStartPath
        serverStopPath = try container.decodeIfPresent(String.self, forKey: .serverStopPath) ?? serverStopPath
        serverLogsPath = try container.decodeIfPresent(String.self, forKey: .serverLogsPath) ?? serverLogsPath
    }
}

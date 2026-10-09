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

enum NativeDashboardMutation {
    case runBackup
    case restoreBackup(service: String, file: String)
    case runVulnerabilityScan

    var label: String {
        switch self {
        case .runBackup: return "backup"
        case .restoreBackup: return "backup restore"
        case .runVulnerabilityScan: return "vulnerability scan"
        }
    }

    var path: String {
        switch self {
        case .runBackup: return "backup"
        case .restoreBackup: return "backup/restore"
        case .runVulnerabilityScan: return "vulnerabilities/scan"
        }
    }

    var body: Data {
        switch self {
        case .runBackup, .runVulnerabilityScan:
            return Data("{}".utf8)
        case .restoreBackup(let service, let file):
            let payload = ["service": service, "file": file]
            return (try? JSONEncoder().encode(payload)) ?? Data("{}".utf8)
        }
    }

    var userAgent: String? {
        "hanasand_internal"
    }

    func baseURL(settings: HanasandDesktopSettings) -> URL {
        settings.internalAPIBaseURL.normalizedBaseURL
    }
}

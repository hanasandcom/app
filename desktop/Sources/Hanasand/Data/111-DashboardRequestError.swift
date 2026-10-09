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

enum DashboardRequestError: LocalizedError {
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .httpStatus(401):
            return "Your Hanasand login session expired. Sign in again to refresh it."
        case .httpStatus(403):
            return "Access denied for this dashboard route."
        case .httpStatus(let status):
            return "Dashboard endpoint returned HTTP \(status)."
        }
    }
}

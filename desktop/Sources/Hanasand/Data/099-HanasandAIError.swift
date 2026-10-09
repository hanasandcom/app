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

enum HanasandAIError: LocalizedError {
    case invalidPayload
    case httpStatus(Int, String?, AIRateLimitSnapshot?)

    var errorDescription: String? {
        switch self {
        case .invalidPayload:
            return "Could not encode the Hanasand AI request."
        case .httpStatus(let status, let error, _):
            if status == 401 {
                _ = error
                return "Refreshing the Hanasand session in the background. Try again in a moment if this message stays visible."
            }
            if status == 429 {
                return "Limit reached. Hanasand will try again when capacity returns."
            }
            if [502, 503, 504].contains(status) {
                return error ?? "The AI service is taking longer than expected. I’ll keep trying in the background."
            }
            return error ?? "The Hanasand AI endpoint returned HTTP \(status)."
        }
    }
}

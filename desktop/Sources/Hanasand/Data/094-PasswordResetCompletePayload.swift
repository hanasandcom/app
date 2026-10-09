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

struct PasswordResetCompletePayload: Encodable {
    let id: String
    let resetToken: String
    let password: String
}

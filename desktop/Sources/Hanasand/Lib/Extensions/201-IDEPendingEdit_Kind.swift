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

extension IDEPendingEdit.Kind {
    init(_ kind: IDEEditChatCommand.Kind) {
        switch kind {
        case .replaceLine: self = .replaceLine
        case .insertAfterLine: self = .insertAfterLine
        case .patch: self = .patch
        }
    }
}

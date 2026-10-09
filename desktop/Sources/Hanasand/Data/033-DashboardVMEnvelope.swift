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

struct DashboardVMEnvelope: Decodable {
    let resolvedVMs: [DashboardVM]

    enum CodingKeys: String, CodingKey {
        case data
        case vms
    }

    init(from decoder: Decoder) throws {
        if let list = try? [DashboardVM](from: decoder) {
            resolvedVMs = list
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let list = try? container.decode([DashboardVM].self, forKey: .data) {
            resolvedVMs = list
        } else if let list = try? container.decode([DashboardVM].self, forKey: .vms) {
            resolvedVMs = list
        } else {
            resolvedVMs = []
        }
    }
}

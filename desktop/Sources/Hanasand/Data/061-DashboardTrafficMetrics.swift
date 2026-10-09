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

struct DashboardTrafficMetrics: Decodable {
    struct Metric: Decodable, Identifiable {
        var id: String { key }
        let key: String
        let count: Int
    }

    let totalRequests: Int
    let avgRequestTime: Double
    let errorRate: Double
    let topDomains: [Metric]

    enum CodingKeys: String, CodingKey {
        case totalRequests = "total_requests"
        case avgRequestTime = "avg_request_time"
        case errorRate = "error_rate"
        case topDomains = "top_domains"
    }
}

struct HanasandTrafficSummaryMetric: Decodable {
    let value: String
    let hitsHour: Int?
    let hitsToday: Int?
    let hitsLastWeek: Int?
    let hitsTotal: Int?

    var bestCount: Int {
        hitsToday ?? hitsHour ?? hitsLastWeek ?? hitsTotal ?? 0
    }

    enum CodingKeys: String, CodingKey {
        case value
        case hitsHour = "hits_hour"
        case hitsToday = "hits_today"
        case hitsLastWeek = "hits_last_week"
        case hitsTotal = "hits_total"
    }
}

struct HanasandTrafficDomainTPS: Decodable {
    let name: String
    let tps: Double?
}

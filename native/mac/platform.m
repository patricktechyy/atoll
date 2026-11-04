// Run the screen recording request inside Atoll's main process so macOS
// associates the privacy entry with the app bundle the user launched.
#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>
#include <node_api.h>
#include <CoreGraphics/CoreGraphics.h>

static napi_value request_screen(napi_env env, napi_callback_info info) {
    napi_value result;
    napi_get_boolean(env, CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess(), &result);
    return result;
}
static napi_value string(napi_env env, NSString *value) {
    napi_value result;
    napi_create_string_utf8(env,(value ?: @"").UTF8String,NAPI_AUTO_LENGTH,&result);
    return result;
}
static NSString *argument(napi_env env,napi_callback_info info) {
    size_t count=1,n=0; napi_value v;
    napi_get_cb_info(env,info,&count,&v,NULL,NULL);
    if (!count || napi_get_value_string_utf8(env,v,NULL,0,&n)!=napi_ok) return @"";
    NSMutableData *data=[NSMutableData dataWithLength:n+1];
    napi_get_value_string_utf8(env,v,data.mutableBytes,n+1,&n);
    return [[NSString alloc] initWithBytes:data.bytes length:n encoding:NSUTF8StringEncoding];
}
static napi_value formats(napi_env env,napi_callback_info info) {
    NSArray *types=NSPasteboard.generalPasteboard.types;
    napi_value result; napi_create_array_with_length(env,types.count,&result);
    for (NSUInteger i=0;i<types.count;i++) {
        NSString *type=types[i];
        if ([type isEqual:NSPasteboardTypePNG] || [type isEqual:NSPasteboardTypeTIFF]) type=@"image/png";
        napi_set_element(env,result,(uint32_t)i,string(env,type));
    }
    return result;
}
static napi_value readText(napi_env env,napi_callback_info info) {
    return string(env,[NSPasteboard.generalPasteboard stringForType:NSPasteboardTypeString]);
}
static napi_value writeText(napi_env env,napi_callback_info info) {
    NSString *text=argument(env,info);
    [NSPasteboard.generalPasteboard clearContents];
    [NSPasteboard.generalPasteboard setString:text forType:NSPasteboardTypeString]; return NULL;
}
static napi_value hasType(napi_env env,napi_callback_info info) {
    napi_value result; napi_get_boolean(env,[NSPasteboard.generalPasteboard.types containsObject:argument(env,info)],&result); return result;
}
static napi_value readPNG(napi_env env,napi_callback_info info) {
    NSPasteboard *pb=NSPasteboard.generalPasteboard;
    NSData *data=[pb dataForType:NSPasteboardTypePNG];
    if (!data) {
        NSData *tiff=[pb dataForType:NSPasteboardTypeTIFF];
        if (tiff) data=[[NSBitmapImageRep imageRepWithData:tiff] representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    }
    napi_value result; napi_create_buffer_copy(env,data.length,data.bytes,NULL,&result); return result;
}
static napi_value writePNG(napi_env env,napi_callback_info info) {
    size_t count=1,n=0; void *bytes=NULL; napi_value v;
    napi_get_cb_info(env,info,&count,&v,NULL,NULL);
    if (count && napi_get_buffer_info(env,v,&bytes,&n)==napi_ok && n) {
        [NSPasteboard.generalPasteboard clearContents];
        [NSPasteboard.generalPasteboard setData:[NSData dataWithBytes:bytes length:n] forType:NSPasteboardTypePNG];
    }
    return NULL;
}
@interface AtollCalendarJob : NSObject
@property napi_async_work work;
@property napi_deferred deferred;
@property BOOL request;
@property(copy) NSString *result;
@end
@implementation AtollCalendarJob
@end
static void calendarExecute(napi_env env, void *context) {
    @autoreleasepool {
        AtollCalendarJob *job = (__bridge AtollCalendarJob *)context;
        EKEventStore *store = [[EKEventStore alloc] init];
        EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
        if (job.request) {
            dispatch_semaphore_t ready = dispatch_semaphore_create(0);
            void (^completion)(BOOL,NSError *) = ^(BOOL granted,NSError *error) { dispatch_semaphore_signal(ready); };
            if (@available(macOS 14.0,*)) [store requestFullAccessToEventsWithCompletion:completion];
            else [store requestAccessToEntityType:EKEntityTypeEvent completion:completion];
            dispatch_semaphore_wait(ready, DISPATCH_TIME_FOREVER);
            status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];
        }
        BOOL allowed = status == EKAuthorizationStatusAuthorized;
        if (@available(macOS 14.0,*)) allowed = status == EKAuthorizationStatusFullAccess;
        NSMutableArray *calendars = [NSMutableArray array], *events = [NSMutableArray array];
        if (allowed) {
            for (EKCalendar *calendar in [store calendarsForEntityType:EKEntityTypeEvent]) {
                [calendars addObject:@{@"id":calendar.calendarIdentifier, @"title":calendar.title ?: @"Calendar", @"account":calendar.source.title ?: @""}];
            }
            NSDate *start = [NSDate dateWithTimeIntervalSinceNow:-12*3600];
            NSDate *end = [NSDate dateWithTimeIntervalSinceNow:7*86400];
            NSPredicate *predicate = [store predicateForEventsWithStartDate:start endDate:end calendars:nil];
            NSArray *matches = [[store eventsMatchingPredicate:predicate] sortedArrayUsingSelector:@selector(compareStartDateWithEvent:)];
            for (EKEvent *event in matches) {
                if (event.status == EKEventStatusCanceled) continue;
                [events addObject:@{@"id":[NSString stringWithFormat:@"%@/%@/%.0f",event.calendar.calendarIdentifier,event.eventIdentifier ?: @"",event.startDate.timeIntervalSince1970*1000],
                    @"calendarId":event.calendar.calendarIdentifier, @"title":event.title ?: @"(No title)",
                    @"start":@(event.startDate.timeIntervalSince1970*1000), @"end":@(event.endDate.timeIntervalSince1970*1000),
                    @"allDay":@(event.allDay), @"location":event.location ?: @"", @"url":event.URL.absoluteString ?: @"", @"notes":event.notes ?: @""}];
                if (events.count >= 1000) break;
            }
        }
        NSDictionary *payload = @{@"authorized":@(allowed), @"calendars":calendars, @"events":events,
            @"error":allowed ? NSNull.null : @"Allow Calendar access for Atoll in System Settings → Privacy & Security → Calendars."};
        NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
        job.result = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    }
}
static void calendarComplete(napi_env env,napi_status status,void *context) {
    AtollCalendarJob *job = CFBridgingRelease(context);
    napi_resolve_deferred(env,job.deferred,string(env,job.result ?: @"{}"));
    napi_delete_async_work(env,job.work);
}
static napi_value calendarEvents(napi_env env,napi_callback_info info) {
    size_t count=1; napi_value value; bool request=false;
    napi_get_cb_info(env,info,&count,&value,NULL,NULL);
    if (count) napi_get_value_bool(env,value,&request);
    AtollCalendarJob *job = [AtollCalendarJob new]; job.request=request;
    napi_value promise, label; napi_deferred deferred; napi_async_work work;
    napi_create_promise(env,&deferred,&promise);job.deferred=deferred;
    napi_create_string_utf8(env,"Apple Calendar",NAPI_AUTO_LENGTH,&label);
    void *context=(__bridge_retained void *)job;
    napi_create_async_work(env,NULL,label,calendarExecute,calendarComplete,context,&work);job.work=work;
    napi_queue_async_work(env,work);return promise;
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor methods[]={
      {"calendarEvents",NULL,calendarEvents},{"requestScreen",NULL,request_screen},{"readText",NULL,readText},{"writeText",NULL,writeText},
      {"availableFormats",NULL,formats},{"has",NULL,hasType},{"readPNG",NULL,readPNG},{"writePNG",NULL,writePNG}
    };
    napi_define_properties(env,exports,sizeof(methods)/sizeof(methods[0]),methods);
    return exports;
}
NAPI_MODULE(atoll_platform, initialize)

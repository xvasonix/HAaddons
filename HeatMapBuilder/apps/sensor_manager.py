import json
from typing import Optional, Dict, Any, List, Union
from websocket_client import WebSocketClient, MockWebSocketClient
import time

class SensorManager:
    """센서 상태 관리를 담당하는 클래스"""
    
    def __init__(self, is_local: bool, config_manager, logger, supervisor_token):
        self.is_local = is_local
        self.config_manager = config_manager
        self.logger = logger
        
        # 웹소켓 클라이언트 초기화
        self.websocket_client = (
            MockWebSocketClient(config_manager, logger) if is_local 
            else WebSocketClient(supervisor_token, logger)
        )
        
        self.logger.trace(f"SensorManager: 웹소켓 클라이언트 초기화 완료 (타입: {'모의' if is_local else '실제'})")

    async def debug_websocket(self, message_type: str, **kwargs) -> Optional[Any]:
        """WebSocket 디버깅 메시지 전송"""
        self.logger.debug(f"SensorManager: 디버깅 메시지 전송 - {message_type}")
        return await self.websocket_client.send_message(message_type, **kwargs)

    async def get_entity_registry(self) -> List[Dict]:
        """Entity Registry 조회"""

        self.logger.trace("Entity Registry 조회 요청 시작")
        start_time = time.time()
        result = await self.websocket_client.send_message("config/entity_registry/list")
        elapsed_time = time.time() - start_time
        
        if result is not None:
            self.logger.trace(f"Entity Registry 조회 성공: {len(result)}개 항목 (소요시간: {elapsed_time:.3f}초)")
        else:
            self.logger.error(f"Entity Registry 조회 실패 (소요시간: {elapsed_time:.3f}초)")
            
        return result if result is not None else []

    async def get_label_registry(self) -> List[Dict]:
        """Label Registry 조회"""
        self.logger.trace("Label Registry 조회 요청 시작")
        start_time = time.time()
        result = await self.websocket_client.send_message("config/label_registry/list")
        elapsed_time = time.time() - start_time
        
        if result is not None:
            self.logger.trace(f"Label Registry 조회 성공: {len(result)}개 항목 (소요시간: {elapsed_time:.3f}초)")
        else:
            self.logger.error(f"Label Registry 조회 실패 (소요시간: {elapsed_time:.3f}초)")
            
        return result if result is not None else []

    async def get_all_states(self) -> List[Dict]:
        """모든 센서 상태 조회"""
        try:
            self.logger.trace("===== 센서 상태 조회 시작 =====")
            overall_start_time = time.time()
            
            # Entity Registry 정보 가져오기
            self.logger.trace("Entity Registry 정보 요청 중...")
            entity_registry_start = time.time()
            entity_registry = await self.get_entity_registry()
            entity_registry_time = time.time() - entity_registry_start
            
            if not entity_registry:
                self.logger.error(f"Entity Registry 정보 수신 실패 (소요시간: {entity_registry_time:.3f}초)")
            else:
                self.logger.trace(f"Entity Registry 정보 수신 완료: {len(entity_registry)}개 항목 (소요시간: {entity_registry_time:.3f}초)")
            
            entity_registry_dict = {
                entry['entity_id']: entry 
                for entry in entity_registry
            }
            
            # 상태 정보 가져오기
            self.logger.trace("===== get_states 요청 시작 =====")
            states_start = time.time()
            
            # get_states 요청 전송
            self.logger.trace("get_states 요청 전송 중...")
            states = await self.websocket_client.send_message("get_states")
            states_time = time.time() - states_start
            
            if states is None:
                self.logger.error(f"get_states 요청 실패: 응답이 None입니다 (소요시간: {states_time:.3f}초)")
                return []
                
            self.logger.trace(f"get_states 응답 수신 완료: {len(states)}개 항목 (소요시간: {states_time:.3f}초)")

            # 센서 필터링 및 처리
            self.logger.trace("센서 데이터 필터링 시작...")
            filtering_start = time.time()
            
            filtered_states = []
            sensor_count = 0
            valid_sensor_count = 0
            
            for state in states:
                entity_id = state['entity_id']
                if not entity_id.startswith('sensor.'):
                    continue
                    
                sensor_count += 1
                
                try:
                    # # 숫자 값인지 확인
                    # _ = float(state['state'])
                    valid_sensor_count += 1
                    
                    # Entity Registry 정보 추가
                    if entity_id in entity_registry_dict:
                        state.update({
                            'labels': entity_registry_dict[entity_id].get('labels', []),
                            'area_id': entity_registry_dict[entity_id].get('area_id')
                        })
                        filtered_states.append(state)
                except (ValueError, TypeError):
                    # 숫자가 아닌 상태값은 무시
                    continue
            
            filtering_time = time.time() - filtering_start
            overall_time = time.time() - overall_start_time
            
            self.logger.trace(f"센서 필터링 완료 (소요시간: {filtering_time:.3f}초)")
            self.logger.trace(f"센서 상태 조회 결과: 전체 {sensor_count}개 중 {valid_sensor_count}개 유효, {len(filtered_states)}개 필터링됨")

            self.logger.trace(f"===== 센서 상태 조회 완료 (총 소요시간: {overall_time:.3f}초) =====")
            
            return filtered_states
            
        except Exception as e:
            import traceback
            self.logger.error(f"센서 상태 조회 중 오류 발생: {str(e)}")
            self.logger.error(traceback.format_exc())
            return []
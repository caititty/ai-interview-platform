import java.util.HashMap;
import java.util.Map;

public class test {
    public static void main(String[] args) {
        Map<Integer,Integer> map = new HashMap<Integer,Integer>();
        int [] nums = new int[]{3,2,3};
        int max = 0;
        for(int i=0; i<nums.length; i++){

            if(map.get(nums[i]) != null){
                map.put(nums[i],map.get(nums[i])+1);
                max = Math.max(max,map.get(nums[i]));
            }else{
                map.put(nums[i],1);
            }
        }
        System.out.println(max);


    }
    }
}
